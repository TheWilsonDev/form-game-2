const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// Serve static files from public directory
app.use(express.static("public"));

// Game constants
const GRAVITY = 0.5;
const JUMP_FORCE = -12;
const PLATFORMS = [
  { x: 0, y: 500, width: 800, height: 20 }, // Ground
  { x: 50, y: 200, width: 100, height: 20 }, // New platform under player start
  { x: 200, y: 400, width: 100, height: 20 }, // Platform 1
  { x: 400, y: 300, width: 100, height: 20 }, // Platform 2
  { x: 600, y: 200, width: 100, height: 20 }, // Platform 3
];
const BOMB_FUSE_TIME = 2000; // ms
const BOMB_GRAVITY = 0.2;
const BOMB_BOUNCE = 0.5;
const BOMB_DAMAGE = 50;
const BOMB_RADIUS = 50;
const DEATH_Y = 1000; // Y-coordinate below which players die

// Store game objects
const players = {};
const projectiles = {}; // Store active projectiles
const bombs = {}; // Store active bombs { id, ownerId, x, y, vx, vy, fuseTimerId }
let projectileIdCounter = 0; // Simple ID counter
let bombIdCounter = 0;

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("a user connected");

  // Generate a unique ID for the player
  const playerId = socket.id;

  // Add new player to the players object
  players[playerId] = {
    x: 100,
    y: 100,
    velocityY: 0,
    isJumping: false,
    color: getRandomColor(),
    health: 100,
    isDead: false, // Add dead state
  };

  // Send the current players list (including health), platforms, and the new player's ID
  socket.emit("currentPlayers", players);
  socket.emit("platforms", PLATFORMS);
  socket.emit("playerId", playerId);

  // Broadcast the new player (including health) to all other clients
  socket.broadcast.emit("newPlayer", {
    id: playerId,
    ...players[playerId], // Spread includes health
  });

  // Handle player shooting
  socket.on("shoot", (target) => {
    const player = players[socket.id];
    if (!player) return; // Player might have disconnected

    // Calculate direction vector
    const directionX = target.x - (player.x + 10); // Center of player
    const directionY = target.y - (player.y + 10); // Center of player
    const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);

    const velocityX = (directionX / magnitude) * 10; // Adjust speed (10) as needed
    const velocityY = (directionY / magnitude) * 10;

    // Create projectile
    const projectileId = projectileIdCounter++;
    projectiles[projectileId] = {
      id: projectileId,
      ownerId: socket.id,
      x: player.x + 10, // Start from player center
      y: player.y + 10,
      velocityX: velocityX,
      velocityY: velocityY,
      color: player.color, // Use player's color
    };

    // Broadcast the new projectile to all clients
    io.emit("newProjectile", projectiles[projectileId]);
  });

  // Handle player movement
  socket.on("playerMove", (movement) => {
    const player = players[socket.id]; // Use socket.id here
    // Only process movement if player exists and is not dead
    if (player && !player.isDead) {
      player.x = movement.x;
      player.y = movement.y;
      player.velocityY = movement.velocityY;
      player.isJumping = movement.isJumping;

      // Broadcast the movement
      socket.broadcast.emit("playerMoved", {
        id: socket.id,
        x: player.x,
        y: player.y,
        velocityY: player.velocityY,
        isJumping: player.isJumping,
      });
    }
  });

  // --- Request Respawn Handler ---
  socket.on("requestRespawn", () => {
    const player = players[socket.id];
    if (player && player.isDead) {
      console.log(`Player ${socket.id} respawning`);
      // Reset player state
      player.x = 100;
      player.y = 100;
      player.velocityY = 0;
      player.health = 100;
      player.isDead = false;

      // Broadcast the respawn event including the player ID
      io.emit("playerRespawned", {
        id: socket.id, // Include the ID
        ...player, // Spread the rest of the player data
      });
    }
  });

  // --- Throw Bomb Handler ---
  socket.on("throwBomb", (target) => {
    const player = players[socket.id];
    if (!player || player.isDead) return;

    console.log(`Player ${socket.id} throwing bomb towards ${target.x}, ${target.y}`);

    // Calculate initial velocity (simple arc towards target)
    const throwPower = 7;
    const directionX = target.x - (player.x + 10);
    const directionY = target.y - (player.y + 10);
    const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
    const velocityX = (directionX / magnitude) * throwPower;
    const velocityY = (directionY / magnitude) * throwPower - 4; // Add upward arc bias

    const bombId = bombIdCounter++;
    const bomb = {
      id: bombId,
      ownerId: socket.id,
      x: player.x + 10,
      y: player.y + 10,
      vx: velocityX,
      vy: velocityY,
      fuseTimerId: null, // Internal server state
    };

    // Set fuse timer (server-side only)
    bomb.fuseTimerId = setTimeout(() => {
      handleBombExplosion(bombId);
    }, BOMB_FUSE_TIME);

    bombs[bombId] = bomb;

    // --- Emit only client-needed data for the new bomb ---
    io.emit("newBomb", {
      id: bomb.id,
      ownerId: bomb.ownerId,
      x: bomb.x,
      y: bomb.y,
      vx: bomb.vx, // Client might use initial velocity for prediction
      vy: bomb.vy, // Client might use initial velocity for prediction
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    // Player object might already be deleted if they died and didn't respawn
    if (players[socket.id]) {
      delete players[socket.id];
    }
    io.emit("playerDisconnected", socket.id);
  });
});

// Simple AABB collision check function
function checkCollision(rect1, rect2) {
  return rect1.x < rect2.x + rect2.width && rect1.x + rect1.width > rect2.x && rect1.y < rect2.y + rect2.height && rect1.y + rect1.height > rect2.y;
}

// Server-side game loop for projectile updates
setInterval(() => {
  const projectilesToRemove = [];
  for (const projId in projectiles) {
    const projectile = projectiles[projId];
    projectile.x += projectile.velocityX;
    projectile.y += projectile.velocityY;

    let hitDetected = false;

    // Check for collision with players
    for (const playerId in players) {
      const player = players[playerId];
      // Skip dead players and self-hits
      if (player.isDead || projectile.ownerId === playerId) continue;

      const projectileHitbox = { x: projectile.x - 2, y: projectile.y - 2, width: 4, height: 4 };
      const playerHitbox = { x: player.x, y: player.y, width: 20, height: 20 };

      if (checkCollision(projectileHitbox, playerHitbox)) {
        console.log(`Player ${playerId} hit by projectile ${projId} from ${projectile.ownerId}`);
        player.health -= 25;
        player.health = Math.max(0, player.health);

        // Broadcast health update
        io.emit("playerHealthUpdate", { id: playerId, health: player.health });

        // --- Emit damage effect event ---
        io.emit("playerDamaged", { id: playerId, x: player.x + 10, y: player.y + 10 }); // Emit hit location (center)

        hitDetected = true;
        projectilesToRemove.push(projId);

        // Check for player death
        if (player.health <= 0) {
          const killerId = projectile.ownerId;
          console.log(`Player ${playerId} killed by ${killerId}`);
          player.isDead = true; // Mark player as dead

          // Emit specific kill event
          io.emit("playerKilled", { killedPlayerId: playerId, killerId: killerId });

          // Don't delete the player object here, just mark as dead
          // delete players[playerId];
          // io.emit("playerDisconnected", playerId); // Don't disconnect, just killed
        }
        break; // Projectile hits one player and is removed
      }
    }

    // Boundary check for removal (if no hit)
    if (!hitDetected && (projectile.x < 0 || projectile.x > 800 || projectile.y < 0 || projectile.y > 600)) {
      // Using fixed bounds for now, adjust if needed for dynamic canvas/world size
      projectilesToRemove.push(projId);
    }
  }

  // Remove projectiles that hit or went out of bounds
  projectilesToRemove.forEach((id) => {
    if (projectiles[id]) {
      delete projectiles[id];
      // Notify clients only if it went out of bounds (hit notification is covered by health update/death)
      // We could optimize this, but for now, we just rely on the full projectileUpdate below.
      // io.emit('projectileRemoved', id);
    }
  });

  // Broadcast projectile updates (includes removals)
  io.emit("projectileUpdate", projectiles);

  // --- Update Bombs ---
  const bombUpdatesArray = []; // Create an array for client updates
  for (const bombId in bombs) {
    const bomb = bombs[bombId];

    // Apply gravity & update position
    bomb.vy += BOMB_GRAVITY;
    bomb.x += bomb.vx;
    bomb.y += bomb.vy;

    // Check for platform collisions (basic bounce)
    for (const platform of PLATFORMS) {
      const bombBottom = bomb.y + 5; // Approximate bomb radius
      const bombRadius = 5;

      // Check if bomb is overlapping horizontally
      if (bomb.x + bombRadius > platform.x && bomb.x - bombRadius < platform.x + platform.width) {
        // Check if bomb is hitting the top surface and moving down
        if (bombBottom >= platform.y && bomb.y - bombRadius < platform.y && bomb.vy > 0) {
          bomb.y = platform.y - bombRadius;
          bomb.vy *= -BOMB_BOUNCE; // Reverse and dampen vertical velocity
          bomb.vx *= 0.8; // Dampen horizontal velocity on bounce
          break; // Assume only one platform collision per frame
        }
      }
    }
    // Simple floor bounce (prevent falling through world)
    if (bomb.y + 5 > 600) {
      // Assuming 600 is bottom y
      bomb.y = 600 - 5;
      bomb.vy *= -BOMB_BOUNCE;
      bomb.vx *= 0.8;
    }

    // Add relevant data to the updates array
    bombUpdatesArray.push({
      id: bomb.id,
      x: bomb.x,
      y: bomb.y,
      // vx: bomb.vx, // Optional
      // vy: bomb.vy  // Optional
    });
  }
  // --- Broadcast bomb updates (array of positions) ---
  // No need to check length, empty array is fine
  io.emit("bombUpdate", bombUpdatesArray);

  // --- Check for Player Fall Death ---
  for (const playerId in players) {
    const player = players[playerId];
    // Check only living players
    if (!player.isDead && player.y > DEATH_Y) {
      console.log(`Player ${playerId} fell out of the world.`);
      player.isDead = true;
      // Emit kill event, killerId is null for world deaths
      io.emit("playerKilled", { killedPlayerId: playerId, killerId: null });
    }
  }
}, 1000 / 60); // Update at roughly 60 FPS

// Helper function to generate random colors
function getRandomColor() {
  const colors = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// --- Bomb Explosion Logic ---
function handleBombExplosion(bombId) {
  const bomb = bombs[bombId];
  if (!bomb) return; // Already exploded or removed

  console.log(`Bomb ${bombId} exploded at ${bomb.x}, ${bomb.y}`);

  // Notify clients first (for the visual effect)
  io.emit("bombExploded", { id: bombId, x: bomb.x, y: bomb.y, radius: BOMB_RADIUS });

  // Damage calculation with falloff
  for (const playerId in players) {
    const player = players[playerId];
    if (player.isDead) continue;

    const playerCenterX = player.x + 10;
    const playerCenterY = player.y + 10;
    const distance = Math.sqrt(Math.pow(playerCenterX - bomb.x, 2) + Math.pow(playerCenterY - bomb.y, 2));

    if (distance <= BOMB_RADIUS) {
      // Calculate damage based on distance (linear falloff)
      const falloffFactor = 1 - distance / BOMB_RADIUS; // 1 at center, 0 at edge
      const damageDealt = Math.round(BOMB_DAMAGE * falloffFactor); // Round damage

      console.log(`Bomb ${bombId} hit player ${playerId} at distance ${distance.toFixed(1)}, dealing ${damageDealt} damage`);

      player.health -= damageDealt;
      player.health = Math.max(0, player.health);
      io.emit("playerHealthUpdate", { id: playerId, health: player.health });
      io.emit("playerDamaged", { id: playerId, x: playerCenterX, y: playerCenterY }); // Trigger blood effect

      if (player.health <= 0) {
        const killerId = bomb.ownerId; // Attributed to the bomb thrower
        console.log(`Player ${playerId} killed by bomb from ${killerId}`);
        player.isDead = true;
        io.emit("playerKilled", { killedPlayerId: playerId, killerId: killerId });
      }
    }
  }

  // Clear timer just in case (should be redundant)
  clearTimeout(bomb.fuseTimerId);
  // Remove bomb from state
  delete bombs[bombId];
}

// Start the server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
