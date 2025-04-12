// Canvas setup
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Game theme and visual settings
const THEME = {
  background: "#0a0a20", // Dark space blue
  backgroundStars: ["#ffffff", "#aaaaff", "#7777ff"], // Star colors
  platformGradient: ["#41a6ff", "#2a78d1"], // Platform gradient colors
  healthBarBackground: "#333333",
  healthBarFill: "#22cc22",
  healthBarBorder: "#ffffff",
  uiTextColor: "#ffffff",
  uiBackground: "rgba(10, 10, 32, 0.7)",
  uiPanelBackground: "rgba(30, 30, 60, 0.8)",
  uiBorder: "#4169e1",
  deathOverlay: "rgba(0, 0, 0, 0.7)",
  deathTextColor: "#ff3333",
  killFeedBackground: "rgba(30, 30, 60, 0.9)",
  killFeedBorder: "#5555ff",
  killFeedText: "#ffffff",
  killHighlight: "#ff5555",
  respawnBackground: "rgba(20, 0, 0, 0.85)",
  respawnHeaderColor: "#ff3333",
  respawnTextColor: "#ffffff",
  respawnAccentColor: "#ff7700",
  respawnButtonGradient: ["#ff4400", "#cc2200"],
  respawnButtonHover: ["#ff5500", "#dd3300"],
  respawnPanelBackground: "rgba(40, 10, 10, 0.8)",
};

// Pre-generate visual elements
const stars = []; // Background stars
const NUM_STARS = 150;
function generateStars() {
  for (let i = 0; i < NUM_STARS; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5,
      color: THEME.backgroundStars[Math.floor(Math.random() * THEME.backgroundStars.length)],
      blinkRate: Math.random() * 0.02, // How fast the star blinks
      blinkOffset: Math.random() * Math.PI * 2, // Initial phase of blink
    });
  }
}

// Function to resize canvas
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  generateStars(); // Regenerate stars for new size
}

// Initial resize
resizeCanvas();

// Resize canvas when window size changes
window.addEventListener("resize", resizeCanvas);

// Game state
let players = {};
let localPlayerId = null;
let platforms = [];
let projectiles = {}; // Store projectiles locally
let killMessages = []; // Store kill messages { text: string, time: number, duration: number }
const GRAVITY = 0.5;
const JUMP_FORCE = -12;
let cameraX = 0;
let cameraY = 0;
const LERP_FACTOR = 0.1; // Smoothing factor (0.0 to 1.0, smaller is smoother)
const KILL_MESSAGE_DURATION = 3000; // ms
let showRespawnButton = false;
let spectatingPlayerId = null; // ID of the player camera is following (null if self)
let particles = []; // Store active particles { x, y, vx, vy, size, color, life }
const PARTICLE_LIFESPAN = 500; // ms
let bombs = {}; // Store bombs locally { id, x, y, ... other synced props like fuse? }
let explosionParticles = []; // Store explosion particles
const EXPLOSION_PARTICLE_LIFESPAN = 800;
let respawnAnimationTime = 0; // Time tracking for pulsing animation
let playerStats = {
  kills: 0,
  deaths: 0,
};
let showControlsHelp = true; // Show controls initially, can be toggled
let lastKilledBy = null; // Track who killed the player last

// Animation state
let characterAnims = {};

// Kill feed animations
let killFeedAnims = [];

// Socket.IO connection
const socket = io();

// Handle initial connection
socket.on("connect", () => {
  console.log("Connected to server");
});

// Handle receiving player ID
socket.on("playerId", (id) => {
  localPlayerId = id;
  console.log("My player ID:", id);
});

// Handle receiving current players
socket.on("currentPlayers", (currentPlayers) => {
  players = currentPlayers;
  console.log("Current players:", players);
});

// Handle receiving platforms
socket.on("platforms", (serverPlatforms) => {
  platforms = serverPlatforms;
  console.log("Platforms received:", platforms);
});

// Handle new player joining
socket.on("newPlayer", (playerData) => {
  players[playerData.id] = playerData;
  console.log("New player joined:", playerData);
});

// Handle player movement
socket.on("playerMoved", (playerData) => {
  const player = players[playerData.id];
  if (player) {
    player.x = playerData.x;
    player.y = playerData.y;
    player.velocityY = playerData.velocityY;
    player.isJumping = playerData.isJumping;
    // Note: Health isn't updated here, needs a separate event
  }
});

// Handle player disconnection
socket.on("playerDisconnected", (playerId) => {
  delete players[playerId];
  console.log("Player disconnected:", playerId);
  // If the disconnected player is the local player (e.g., kicked), hide respawn button
  if (playerId === localPlayerId) {
    showRespawnButton = false;
  }
});

// --- Projectile Event Listeners ---
socket.on("newProjectile", (projectileData) => {
  projectiles[projectileData.id] = projectileData;
  console.log("New projectile received:", projectileData);
});

socket.on("projectileUpdate", (serverProjectiles) => {
  projectiles = serverProjectiles; // Overwrite local state with server state
});

socket.on("projectileRemoved", (projectileId) => {
  delete projectiles[projectileId];
  console.log("Projectile removed:", projectileId);
});

// --- Add Listener for Health Updates (for future use) ---
socket.on("playerHealthUpdate", (healthData) => {
  const player = players[healthData.id];
  if (player) {
    player.health = healthData.health;
    console.log(`Player ${healthData.id} health updated: ${player.health}`);
  }
});

// --- Player Damaged Listener ---
socket.on("playerDamaged", (damageData) => {
  console.log(`Player ${damageData.id} damaged at ${damageData.x}, ${damageData.y}`);

  // Create blood particles
  for (let i = 0; i < 10; i++) {
    particles.push({
      x: damageData.x,
      y: damageData.y,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5 - 2,
      size: Math.random() * 3 + 1,
      color: "red",
      life: PARTICLE_LIFESPAN,
    });
  }

  // Add hit effect animation
  if (characterAnims[damageData.id]) {
    characterAnims[damageData.id].hitEffect = 1.0; // Full effect
  }
});

// --- Player Killed Listener ---
socket.on("playerKilled", (killData) => {
  const { killedPlayerId, killerId } = killData;
  const killedPlayerName = players[killedPlayerId]?.color || "Someone";
  const killerPlayerName = players[killerId]?.color || "Someone";

  let messageText = `${killerPlayerName} eliminated ${killedPlayerName}`;
  let isLocalInvolved = false;
  let isLocalKiller = false;

  if (killerId === localPlayerId) {
    messageText = `You eliminated ${killedPlayerName}`;
    playerStats.kills++;
    isLocalKiller = true;
    isLocalInvolved = true;
  } else if (killedPlayerId === localPlayerId) {
    messageText = killerId === null ? "You fell out of the world" : `Eliminated by ${killerPlayerName}`;
    playerStats.deaths++;
    lastKilledBy = killerId;
    isLocalInvolved = true;
  }

  // Create enhanced kill feed entry
  killFeedAnims.push({
    text: messageText,
    time: Date.now(),
    duration: KILL_MESSAGE_DURATION,
    scale: 0, // Starting scale (will animate up)
    opacity: 0, // Starting opacity
    isLocalInvolved: isLocalInvolved,
    isLocalKiller: isLocalKiller,
    killerColor: players[killerId]?.color || "#ffffff",
    killedColor: players[killedPlayerId]?.color || "#ffffff",
    shake: 0, // For shake effect
  });

  console.log(messageText);

  // Update local player state if killed
  if (players[killedPlayerId]) {
    players[killedPlayerId].isDead = true;

    // Create death particles
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: players[killedPlayerId].x + 10,
        y: players[killedPlayerId].y + 10,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 3,
        size: Math.random() * 5 + 2,
        color: players[killedPlayerId].color,
        life: PARTICLE_LIFESPAN * 1.5,
      });
    }

    console.log(`Player ${killedPlayerId} marked as dead locally.`);
  }

  // Check if the local player was killed
  if (killedPlayerId === localPlayerId) {
    showRespawnButton = true;
    spectatingPlayerId = killerId;
    // Reset respawn screen animation values
    respawnAnimationStartTime = Date.now();
    respawnScreenAlpha = 0;
    respawnElementsAlpha = 0;
    respawnStatsRevealed = false;
    console.log(`You died! Spectating ${killerPlayerName}. Click to respawn.`);
  }
});

// --- Player Respawned Listener ---
socket.on("playerRespawned", (playerData) => {
  console.log("[DEBUG] playerRespawned received:", JSON.stringify(playerData)); // Log received data
  // Update the player's state in the local dictionary
  players[playerData.id] = playerData;
  console.log(`Player ${playerData.id} respawned`);

  // If the respawned player is the local player, stop spectating and hide the button
  if (playerData.id === localPlayerId) {
    showRespawnButton = false;
    spectatingPlayerId = null; // Stop spectating, follow self again
    console.log("[DEBUG] Local player respawned, stopped spectating.");
  }
});

// --- Bomb Event Listeners ---
socket.on("newBomb", (bombData) => {
  bombs[bombData.id] = bombData; // Add new bomb
  console.log("New bomb received:", bombData);
});

socket.on("bombUpdate", (bombUpdatesArray) => {
  const updatedBombs = {};
  for (const bombData of bombUpdatesArray) {
    updatedBombs[bombData.id] = bombData;
  }
  // Replace the entire local bombs object with the updated one
  // This automatically handles removals if a bomb is not in the update array
  bombs = updatedBombs;
});

socket.on("bombExploded", (explosionData) => {
  console.log(`Bomb ${explosionData.id} exploded at ${explosionData.x}, ${explosionData.y}`);
  // Create explosion effect
  createExplosionEffect(explosionData.x, explosionData.y, explosionData.radius);
  // Remove the bomb from local state immediately
  delete bombs[explosionData.id];
});

// Keyboard controls
const keys = {
  a: false,
  d: false,
  space: false,
};

// Handle keydown
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "a") keys.a = true;
  if (e.key.toLowerCase() === "d") keys.d = true;
  if (e.key === " ") keys.space = true;

  // Toggle controls help with H key
  if (e.key.toLowerCase() === "h") {
    showControlsHelp = !showControlsHelp;
  }
});

// Handle keyup
document.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "a") keys.a = false;
  if (e.key.toLowerCase() === "d") keys.d = false;
  if (e.key === " ") keys.space = false;
});

// --- Mouse Controls ---
// Store button bounds for hit detection
let respawnButtonBounds = { x: 0, y: 0, width: 0, height: 0 };

// Add a variable to track if mouse is over the respawn button
let respawnButtonHovered = false;
let respawnScreenAlpha = 0;
let respawnElementsAlpha = 0;
let respawnStatsRevealed = false;
let respawnAnimationStartTime = 0;

canvas.addEventListener("click", (event) => {
  // Check if respawn button should be handled
  if (showRespawnButton) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Use the stored button bounds
    if (mouseX >= respawnButtonBounds.x && mouseX <= respawnButtonBounds.x + respawnButtonBounds.width && mouseY >= respawnButtonBounds.y && mouseY <= respawnButtonBounds.y + respawnButtonBounds.height) {
      console.log("Respawn button clicked");
      socket.emit("requestRespawn");
      showRespawnButton = false;
      respawnAnimationTime = 0; // Reset animation time
      return; // Don't process as a shot
    }
  }

  // If not respawning, process as a shot
  if (!localPlayerId || (players[localPlayerId] && players[localPlayerId].isDead)) return; // Don't shoot if not connected or dead

  const rect = canvas.getBoundingClientRect();
  const targetX = event.clientX - rect.left + cameraX;
  const targetY = event.clientY - rect.top + cameraY;
  console.log("Shooting at world coords:", { x: targetX, y: targetY });
  socket.emit("shoot", { x: targetX, y: targetY });
});

// --- Right-Click (Bomb Throw) ---
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault(); // Prevent default right-click menu

  if (!localPlayerId || (players[localPlayerId] && players[localPlayerId].isDead)) return; // Don't throw if not connected or dead

  const rect = canvas.getBoundingClientRect();
  const targetX = event.clientX - rect.left + cameraX;
  const targetY = event.clientY - rect.top + cameraY;
  console.log("Throwing bomb at world coords:", { x: targetX, y: targetY });
  socket.emit("throwBomb", { x: targetX, y: targetY });
});

// Enhance the mouse move event to detect hover over respawn button
canvas.addEventListener("mousemove", (event) => {
  if (showRespawnButton) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Check if mouse is over button
    respawnButtonHovered = mouseX >= respawnButtonBounds.x && mouseX <= respawnButtonBounds.x + respawnButtonBounds.width && mouseY >= respawnButtonBounds.y && mouseY <= respawnButtonBounds.y + respawnButtonBounds.height;
  } else {
    respawnButtonHovered = false;
  }
});

// Check collision with platforms
function checkPlatformCollision(player) {
  for (const platform of platforms) {
    // Check if player is horizontally aligned with the platform
    const platformEndX = platform.x + platform.width;
    const isWithinX = player.x < platformEndX && player.x + 20 > platform.x;

    // Check if player is falling towards the platform
    const isFalling = player.velocityY > 0;

    // Check if player was above the platform in the previous frame
    const wasAbove = player.y + 20 - player.velocityY <= platform.y;

    // Check if player is now at or below the platform surface
    const isAtOrBelow = player.y + 20 >= platform.y;

    if (isWithinX && isFalling && wasAbove && isAtOrBelow) {
      // Collision detected! Snap player to the top of the platform
      player.y = platform.y - 20;
      player.velocityY = 0;
      console.log("COLLISION DETECTED at y:", platform.y);
      return true; // Indicate player is on a platform
    }
  }
  // console.log('No collision detected'); // Keep this commented out for now
  return false; // Indicate player is not on a platform
}

// --- Explosion Effect Function ---
function createExplosionEffect(x, y, radius) {
  // Flash of light at center
  explosionParticles.push({
    x: x,
    y: y,
    vx: 0,
    vy: 0,
    size: radius * 0.8,
    color: "rgba(255, 255, 200, 0.7)",
    life: 150, // Short flash
    type: "light",
  });

  // Create smoke particles
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 2 + 0.5;
    const distance = Math.random() * radius * 0.7;
    explosionParticles.push({
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      vx: Math.cos(angle) * speed * 0.3,
      vy: Math.sin(angle) * speed * 0.3 - 0.5, // Slight upward bias
      size: Math.random() * 15 + 10,
      color: "rgba(50, 50, 50, 0.6)",
      life: EXPLOSION_PARTICLE_LIFESPAN + Math.random() * 500,
      type: "smoke",
    });
  }

  // Create fire particles
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 1;
    explosionParticles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 6 + 3,
      color: Math.random() < 0.7 ? "rgba(255, 150, 50, 0.8)" : "rgba(255, 220, 50, 0.8)", // Orange/yellow mix
      life: EXPLOSION_PARTICLE_LIFESPAN * (0.3 + Math.random() * 0.7),
      type: "fire",
    });
  }

  // Create shrapnel particles
  for (let i = 0; i < 15; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 7 + 3; // Faster than fire particles
    explosionParticles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 3 + 1,
      color: "rgba(200, 200, 200, 0.9)",
      life: EXPLOSION_PARTICLE_LIFESPAN * 1.2,
      type: "shrapnel",
    });
  }
}

// Draw a stylized rounded platform with gradient
function drawPlatform(x, y, width, height) {
  const cornerRadius = 6; // Rounded corners

  // Create gradient
  const gradient = ctx.createLinearGradient(x, y, x, y + height);
  gradient.addColorStop(0, THEME.platformGradient[0]);
  gradient.addColorStop(1, THEME.platformGradient[1]);

  // Draw rounded rectangle
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(x + cornerRadius, y);
  ctx.lineTo(x + width - cornerRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
  ctx.lineTo(x + width, y + height - cornerRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
  ctx.lineTo(x + cornerRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
  ctx.lineTo(x, y + cornerRadius);
  ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
  ctx.closePath();
  ctx.fill();

  // Platform highlight
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + cornerRadius, y);
  ctx.lineTo(x + width - cornerRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
  ctx.stroke();
}

// Draw a stylized player with animations
function drawPlayer(player, isLocalPlayer) {
  const playerId = player.id;

  // Initialize animation state if needed
  if (!characterAnims[playerId]) {
    initPlayerAnimation(playerId);
  }

  const anim = characterAnims[playerId];
  const now = Date.now();

  // Update animation frames based on player state
  if (player.isJumping) {
    // Jump animation
    anim.jumpFrame = (anim.jumpFrame + 0.1) % 1;
  } else {
    anim.jumpFrame = 0;
  }

  // Update direction based on movement
  if (player === players[localPlayerId]) {
    if (keys.a && !keys.d) anim.lastDirection = "left";
    if (keys.d && !keys.a) anim.lastDirection = "right";
  }

  // Walking animation based on horizontal velocity
  const isMovingHorizontally = (player === players[localPlayerId] && (keys.a || keys.d)) || (player !== players[localPlayerId] && player.x !== player.lastX);

  if (player.lastX === undefined) player.lastX = player.x;

  if (isMovingHorizontally && !player.isJumping) {
    anim.walkTime += 0.16;
    anim.walkFrame = Math.sin(anim.walkTime) * 0.5 + 0.5; // 0 to 1 oscillation
  } else {
    // Idle animation
    anim.floatTime += 0.03;
    anim.walkFrame = 0;
  }

  // Store current position for next frame
  player.lastX = player.x;

  // Update blink animation
  anim.blinkTime += 16;
  const isBlinking = anim.blinkTime % 5000 > 4800; // Blink every 5 seconds for 200ms

  // Update hit effect (decay)
  if (anim.hitEffect > 0) {
    anim.hitEffect -= 0.05;
    if (anim.hitEffect < 0) anim.hitEffect = 0;
  }

  // Get floating offset for idle movement
  const floatY = Math.sin(anim.floatTime + anim.floatOffset) * 1.5;

  // Calculate drawing positions
  const baseX = player.x;
  const baseY = player.y + (isMovingHorizontally ? 0 : floatY);

  // Draw shadow (oval below character)
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(baseX + 10, player.y + 20, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Draw hit effect (red flash overlay)
  if (anim.hitEffect > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 0, 0, ${anim.hitEffect * 0.5})`;
    ctx.beginPath();
    ctx.roundRect(baseX - 2, baseY - 2, 24, 24, 5);
    ctx.fill();
    ctx.restore();
  }

  // Draw legs for walking animation
  if (!player.isJumping) {
    ctx.fillStyle = player.color;

    // Left leg
    ctx.beginPath();
    const leftLegX = baseX + 5;
    const legOffsetY = Math.sin(anim.walkTime * 2) * 4;
    ctx.roundRect(leftLegX, baseY + 20, 4, 6 + (isMovingHorizontally ? legOffsetY : 0), 2);
    ctx.fill();

    // Right leg
    ctx.beginPath();
    const rightLegX = baseX + 12;
    const rightLegOffsetY = Math.sin(anim.walkTime * 2 + Math.PI) * 4; // Opposite phase
    ctx.roundRect(rightLegX, baseY + 20, 4, 6 + (isMovingHorizontally ? rightLegOffsetY : 0), 2);
    ctx.fill();
  }

  // Draw arms
  ctx.fillStyle = player.color;

  // Left arm with animation
  const leftArmX = baseX - 2;
  const leftArmY = baseY + 5;
  const leftArmAngle = player.isJumping ? -0.3 : isMovingHorizontally ? Math.sin(anim.walkTime * 2) * 0.3 : 0;

  ctx.save();
  ctx.translate(leftArmX + 3, leftArmY + 2);
  ctx.rotate(leftArmAngle);
  ctx.beginPath();
  ctx.roundRect(-3, -2, 4, 8, 2);
  ctx.fill();
  ctx.restore();

  // Right arm with animation
  const rightArmX = baseX + 18;
  const rightArmY = baseY + 5;
  const rightArmAngle = player.isJumping ? 0.3 : isMovingHorizontally ? Math.sin(anim.walkTime * 2 + Math.PI) * 0.3 : 0;

  ctx.save();
  ctx.translate(rightArmX, rightArmY + 2);
  ctx.rotate(rightArmAngle);
  ctx.beginPath();
  ctx.roundRect(-1, -2, 4, 8, 2);
  ctx.fill();
  ctx.restore();

  // Body (main square)
  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.roundRect(baseX, baseY, 20, 20, 5);
  ctx.fill();

  // Highlight on body
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(baseX + 3, baseY + 3);
  ctx.lineTo(baseX + 17, baseY + 3);
  ctx.lineTo(baseX + 17, baseY + 10);
  ctx.stroke();

  // Face direction
  const faceDirection = anim.lastDirection === "left" ? -1 : 1;

  // Eyes with blinking
  if (!isBlinking) {
    // White part
    ctx.fillStyle = "white";
    ctx.beginPath();

    // Left eye - position based on facing direction
    const leftEyeX = faceDirection === -1 ? baseX + 6 : baseX + 7;
    ctx.arc(leftEyeX, baseY + 8, 3, 0, Math.PI * 2);

    // Right eye - position based on facing direction
    const rightEyeX = faceDirection === -1 ? baseX + 13 : baseX + 14;
    ctx.arc(rightEyeX, baseY + 8, 3, 0, Math.PI * 2);
    ctx.fill();

    // Pupils - follow movement direction
    ctx.fillStyle = "black";
    ctx.beginPath();

    // Pupils move slightly in the direction the character is moving
    const pupilOffset = faceDirection * 1;
    ctx.arc(leftEyeX + pupilOffset, baseY + 8, 1.5, 0, Math.PI * 2);
    ctx.arc(rightEyeX + pupilOffset, baseY + 8, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Blinking (draw closed eyes as lines)
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.beginPath();

    // Left eye closed
    ctx.moveTo(baseX + 5, baseY + 8);
    ctx.lineTo(baseX + 9, baseY + 8);

    // Right eye closed
    ctx.moveTo(baseX + 12, baseY + 8);
    ctx.lineTo(baseX + 16, baseY + 8);
    ctx.stroke();
  }

  // Draw mouth (smiling when active, neutral when idle)
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  if (isMovingHorizontally || player.isJumping) {
    // Smile when active
    const smileStart = baseX + 7;
    const smileEnd = baseX + 13;
    const smileDepth = baseY + 15;

    ctx.moveTo(smileStart, baseY + 13);
    ctx.quadraticCurveTo(baseX + 10, smileDepth, smileEnd, baseY + 13);
  } else {
    // Neutral expression when idle
    ctx.moveTo(baseX + 7, baseY + 14);
    ctx.lineTo(baseX + 13, baseY + 14);
  }
  ctx.stroke();

  // Local player indicator (crown) with slight bob animation
  if (isLocalPlayer) {
    const crownBob = Math.sin(now / 300) * 1;

    ctx.fillStyle = "gold";
    ctx.beginPath();
    ctx.moveTo(baseX + 5, baseY - 3 + crownBob);
    ctx.lineTo(baseX + 15, baseY - 3 + crownBob);
    ctx.lineTo(baseX + 13, baseY + crownBob);
    ctx.lineTo(baseX + 10, baseY - 5 + crownBob);
    ctx.lineTo(baseX + 7, baseY + crownBob);
    ctx.closePath();
    ctx.fill();

    // Add some crown details
    ctx.fillStyle = "orange";
    ctx.beginPath();
    ctx.arc(baseX + 10, baseY - 4 + crownBob, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw health bar
  if (player.health !== undefined) {
    drawHealthBar(baseX, baseY, player.health, 100);
  }
}

// Draw health bar
function drawHealthBar(x, y, health, maxHealth) {
  const barWidth = 30;
  const barHeight = 4;
  const barX = x - 5; // Center bar over player
  const barY = y - 10;

  // Background
  ctx.fillStyle = THEME.healthBarBackground;
  ctx.fillRect(barX, barY, barWidth, barHeight);

  // Health bar (changes color with health level)
  const healthPercentage = health / maxHealth;
  const healthWidth = barWidth * healthPercentage;

  let healthColor;
  if (healthPercentage > 0.6) {
    healthColor = THEME.healthBarFill;
  } else if (healthPercentage > 0.3) {
    healthColor = "orange";
  } else {
    healthColor = "red";
  }

  ctx.fillStyle = healthColor;
  ctx.fillRect(barX, barY, healthWidth, barHeight);

  // Border
  ctx.strokeStyle = THEME.healthBarBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
}

// Draw a stylized projectile
function drawProjectile(projectile) {
  // Glow effect
  ctx.fillStyle = `rgba(${hexToRgb(projectile.color)}, 0.3)`;
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, 6, 0, Math.PI * 2);
  ctx.fill();

  // Main projectile
  ctx.fillStyle = projectile.color;
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, 3, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.beginPath();
  ctx.arc(projectile.x - 1, projectile.y - 1, 1, 0, Math.PI * 2);
  ctx.fill();
}

// Draw a stylized bomb
function drawBomb(bomb) {
  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(bomb.x, bomb.y + 5, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = "black";
  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, 7, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.fillStyle = "rgba(100, 100, 100, 0.8)";
  ctx.beginPath();
  ctx.arc(bomb.x - 2, bomb.y - 2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Fuse
  ctx.strokeStyle = "#8B4513"; // Brown
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bomb.x, bomb.y - 7);
  ctx.lineTo(bomb.x, bomb.y - 12);
  ctx.stroke();

  // Fuse spark (blinking)
  if (Math.random() > 0.5) {
    ctx.fillStyle = "orange";
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y - 12, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Helper to convert hex color to RGB for opacity adjustment
function hexToRgb(hex) {
  // Remove # if present
  hex = hex.replace("#", "");

  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return `${r}, ${g}, ${b}`;
}

// Draw the in-game UI overlay
function drawGameUI() {
  const padding = 15;
  const panelRadius = 10;

  // --- Player Stats Panel (Top Left) ---
  if (localPlayerId && players[localPlayerId]) {
    const player = players[localPlayerId];
    const statsPanelWidth = 180;
    const statsPanelHeight = 90;

    // Panel background
    ctx.fillStyle = THEME.uiPanelBackground;
    ctx.beginPath();
    ctx.roundRect(padding, padding, statsPanelWidth, statsPanelHeight, panelRadius);
    ctx.fill();

    // Panel border
    ctx.strokeStyle = THEME.uiBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Player info text
    ctx.fillStyle = THEME.uiTextColor;
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("PLAYER STATS", padding + 10, padding + 10);

    // Health bar
    const barWidth = 160;
    const barHeight = 8;
    const healthPercentage = player.health / 100;

    // Background
    ctx.fillStyle = THEME.healthBarBackground;
    ctx.fillRect(padding + 10, padding + 35, barWidth, barHeight);

    // Health fill with color based on health level
    let healthColor;
    if (healthPercentage > 0.6) healthColor = THEME.healthBarFill;
    else if (healthPercentage > 0.3) healthColor = "orange";
    else healthColor = "red";

    ctx.fillStyle = healthColor;
    ctx.fillRect(padding + 10, padding + 35, barWidth * healthPercentage, barHeight);

    // Border
    ctx.strokeStyle = THEME.healthBarBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(padding + 10, padding + 35, barWidth, barHeight);

    // Health text
    ctx.fillStyle = THEME.uiTextColor;
    ctx.font = "12px Arial";
    ctx.fillText(`HP: ${Math.floor(player.health)}`, padding + 10, padding + 50);

    // Kills and deaths
    ctx.fillText(`Kills: ${playerStats.kills}`, padding + 10, padding + 65);
    ctx.fillText(`Deaths: ${playerStats.deaths}`, padding + 100, padding + 65);
  }

  // --- Mini-map (Top Right) ---
  const mapSize = 150;
  const mapX = canvas.width - mapSize - padding;
  const mapY = padding;

  // Background
  ctx.fillStyle = THEME.uiPanelBackground;
  ctx.beginPath();
  ctx.roundRect(mapX, mapY, mapSize, mapSize, panelRadius);
  ctx.fill();

  // Border
  ctx.strokeStyle = THEME.uiBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Title
  ctx.fillStyle = THEME.uiTextColor;
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "center";
  ctx.fillText("WORLD MAP", mapX + mapSize / 2, mapY + 15);

  // Draw a minimap of the game world
  const mapPadding = 30; // Padding inside the map panel
  const mapAreaSize = mapSize - mapPadding * 2;
  const mapCenterX = mapX + mapSize / 2;
  const mapCenterY = mapY + mapSize / 2 + 5;

  // Mini platforms (simplified)
  const worldWidth = 2000; // Approximate world width
  const worldHeight = 1000; // Approximate world height
  const scaleX = mapAreaSize / worldWidth;
  const scaleY = mapAreaSize / worldHeight;

  // Draw platforms on mini-map
  ctx.fillStyle = "rgba(65, 166, 255, 0.7)";
  platforms.forEach((platform) => {
    const platformMapX = mapCenterX - (worldWidth / 2) * scaleX + platform.x * scaleX;
    const platformMapY = mapCenterY - (worldHeight / 2) * scaleY + platform.y * scaleY;
    ctx.fillRect(platformMapX, platformMapY, platform.width * scaleX, platform.height * scaleY);
  });

  // Draw players on mini-map
  Object.values(players).forEach((player) => {
    if (player.isDead) return;

    const playerMapX = mapCenterX - (worldWidth / 2) * scaleX + player.x * scaleX;
    const playerMapY = mapCenterY - (worldHeight / 2) * scaleY + player.y * scaleY;

    // Draw player dot
    ctx.fillStyle = player.id === localPlayerId ? "white" : player.color;
    ctx.beginPath();
    ctx.arc(playerMapX, playerMapY, player.id === localPlayerId ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();

    // Highlight local player
    if (player.id === localPlayerId) {
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(playerMapX, playerMapY, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // Camera view indicator
  const viewWidth = canvas.width * scaleX;
  const viewHeight = canvas.height * scaleY;
  const viewX = mapCenterX - (worldWidth / 2) * scaleX + cameraX * scaleX;
  const viewY = mapCenterY - (worldHeight / 2) * scaleY + cameraY * scaleY;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(viewX, viewY, viewWidth, viewHeight);

  // --- Controls Help (Bottom Left, togglable) ---
  if (showControlsHelp) {
    const controlsWidth = 170;
    const controlsHeight = 140;
    const controlsX = padding;
    const controlsY = canvas.height - controlsHeight - padding;

    // Background
    ctx.fillStyle = THEME.uiPanelBackground;
    ctx.beginPath();
    ctx.roundRect(controlsX, controlsY, controlsWidth, controlsHeight, panelRadius);
    ctx.fill();

    // Border
    ctx.strokeStyle = THEME.uiBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Title
    ctx.fillStyle = THEME.uiTextColor;
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "left";
    ctx.fillText("CONTROLS", controlsX + 10, controlsY + 15);

    // Controls text
    ctx.font = "12px Arial";
    let lineHeight = 18;
    let textY = controlsY + 40;

    ctx.fillText("A / D - Move Left/Right", controlsX + 10, textY);
    textY += lineHeight;
    ctx.fillText("SPACE - Jump", controlsX + 10, textY);
    textY += lineHeight;
    ctx.fillText("LEFT CLICK - Shoot", controlsX + 10, textY);
    textY += lineHeight;
    ctx.fillText("RIGHT CLICK - Throw Bomb", controlsX + 10, textY);
    textY += lineHeight;
    ctx.fillText("H - Toggle Controls", controlsX + 10, textY);

    // Hint to hide
    ctx.font = "italic 10px Arial";
    ctx.fillText("Press H to hide", controlsX + 10, controlsY + controlsHeight - 10);
  }

  // --- Players Online Panel (Bottom Right) ---
  const playerCount = Object.keys(players).length;
  const onlinePanelWidth = 150;
  const onlinePanelHeight = 60 + playerCount * 20;
  const onlineX = canvas.width - onlinePanelWidth - padding;
  const onlineY = canvas.height - onlinePanelHeight - padding;

  // Background
  ctx.fillStyle = THEME.uiPanelBackground;
  ctx.beginPath();
  ctx.roundRect(onlineX, onlineY, onlinePanelWidth, onlinePanelHeight, panelRadius);
  ctx.fill();

  // Border
  ctx.strokeStyle = THEME.uiBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Title
  ctx.fillStyle = THEME.uiTextColor;
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";
  ctx.fillText(`PLAYERS ONLINE (${playerCount})`, onlineX + onlinePanelWidth / 2, onlineY + 15);

  // Player list
  ctx.textAlign = "left";
  ctx.font = "12px Arial";
  let playerY = onlineY + 40;

  Object.values(players).forEach((player) => {
    // Color indicator
    ctx.fillStyle = player.color;
    ctx.fillRect(onlineX + 10, playerY - 8, 10, 10);

    // Name/ID and status
    ctx.fillStyle = THEME.uiTextColor;
    const playerName = player.id === localPlayerId ? "YOU" : player.color;
    const status = player.isDead ? "(DEAD)" : "";

    ctx.fillText(`${playerName} ${status}`, onlineX + 30, playerY);

    // Highlight last killer
    if (player.id === lastKilledBy) {
      ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
      ctx.fillText(" ← KILLED YOU", onlineX + 30 + ctx.measureText(`${playerName} ${status}`).width + 5, playerY);
    }

    playerY += 20;
  });
}

// --- Create a new animation system for players ---
function initPlayerAnimation(playerId) {
  if (!characterAnims[playerId]) {
    characterAnims[playerId] = {
      walkFrame: 0,
      walkTime: 0,
      jumpFrame: 0,
      lastDirection: "right",
      blinkTime: Math.random() * 3000, // Random blink start time
      hitEffect: 0, // For hit animation (flash)
      floatOffset: Math.random() * Math.PI * 2, // For floating idle effect
      floatTime: 0,
    };
  }
}

// --- Draw enhanced kill feed ---
function drawKillFeed() {
  const now = Date.now();

  // Update and filter expired messages
  killFeedAnims = killFeedAnims.filter((msg) => now < msg.time + msg.duration);

  // Position for feed (center top)
  const feedY = 100;

  killFeedAnims.forEach((msg, i) => {
    // Animation calculations
    const elapsed = now - msg.time;
    const progress = Math.min(1, elapsed / 400); // 0-1 for intro animation
    const exitProgress = Math.max(0, Math.min(1, (msg.duration - elapsed) / 400)); // 0-1 for exit

    // Update animation properties
    msg.scale = Math.min(1, progress * 1.2); // Overshoot slightly and settle at 1
    msg.opacity = Math.min(1, progress * 2) * exitProgress; // Fade in faster than scale, fade out

    // Update shake effect (for local player kills)
    if (msg.isLocalKiller) {
      const shakePhase = elapsed / 50; // Faster shake
      msg.shake = Math.sin(shakePhase) * 5 * (1 - progress); // Shake amplitude decreases over time
    }

    // Spacing and dimensions
    const marginY = 40;
    const padding = 15;
    const cornerRadius = 8;
    const feedWidth = 350;

    // Position with scale and shake
    const posX = (canvas.width - feedWidth * msg.scale) / 2 + (msg.isLocalKiller ? msg.shake : 0);
    const posY = feedY + i * marginY * msg.scale;

    // Panel background with scale animation
    ctx.save();
    ctx.globalAlpha = msg.opacity;

    // Background panel
    ctx.fillStyle = THEME.killFeedBackground;
    ctx.beginPath();
    ctx.roundRect(posX, posY, feedWidth * msg.scale, 30 * msg.scale, cornerRadius * msg.scale);
    ctx.fill();

    // Special border for locally involved kills
    if (msg.isLocalInvolved) {
      ctx.strokeStyle = msg.isLocalKiller ? "#ffdd00" : THEME.killFeedBorder;
      ctx.lineWidth = 2 * msg.scale;
      ctx.stroke();
    }

    // Kill icon between names
    const iconSize = 16 * msg.scale;
    const iconX = posX + (feedWidth * msg.scale) / 2 - iconSize / 2;
    const iconY = posY + 15 * msg.scale - iconSize / 2;

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();

    // Draw a simple crosshair/target icon
    const iconCenter = iconSize / 2;
    ctx.arc(iconX + iconCenter, iconY + iconCenter, iconSize * 0.3, 0, Math.PI * 2);
    ctx.moveTo(iconX + iconCenter, iconY);
    ctx.lineTo(iconX + iconCenter, iconY + iconSize);
    ctx.moveTo(iconX, iconY + iconCenter);
    ctx.lineTo(iconX + iconSize, iconY + iconCenter);
    ctx.lineWidth = 2 * msg.scale;
    ctx.stroke();

    // Text rendering
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${14 * msg.scale}px Arial`;

    // Extract names from message
    if (msg.text.includes("eliminated")) {
      let parts;

      if (msg.text.startsWith("You eliminated")) {
        // Case: "You eliminated X"
        parts = ["You", msg.killedColor];
        ctx.fillStyle = "#ffff00"; // Yellow for "You"
        ctx.fillText("You", posX + (feedWidth * msg.scale) / 2 - 50 * msg.scale, posY + 15 * msg.scale);

        ctx.fillStyle = msg.killedColor;
        ctx.fillText(parts[1], posX + (feedWidth * msg.scale) / 2 + 50 * msg.scale, posY + 15 * msg.scale);
      } else if (msg.text.startsWith("Eliminated by")) {
        // Case: "Eliminated by X"
        parts = [msg.killerColor, "You"];

        ctx.fillStyle = msg.killerColor;
        ctx.fillText(parts[0], posX + (feedWidth * msg.scale) / 2 - 50 * msg.scale, posY + 15 * msg.scale);

        ctx.fillStyle = "#ffff00"; // Yellow for "You"
        ctx.fillText("You", posX + (feedWidth * msg.scale) / 2 + 50 * msg.scale, posY + 15 * msg.scale);
      } else {
        // Case: "X eliminated Y"
        parts = msg.text.split(" eliminated ");

        ctx.fillStyle = msg.killerColor;
        ctx.fillText(parts[0], posX + (feedWidth * msg.scale) / 2 - 50 * msg.scale, posY + 15 * msg.scale);

        ctx.fillStyle = msg.killedColor;
        ctx.fillText(parts[1], posX + (feedWidth * msg.scale) / 2 + 50 * msg.scale, posY + 15 * msg.scale);
      }
    } else {
      // Generic message or world death
      ctx.fillStyle = THEME.killFeedText;
      ctx.fillText(msg.text, posX + (feedWidth * msg.scale) / 2, posY + 15 * msg.scale);
    }

    ctx.restore();
  });
}

// Game loop
function gameLoop() {
  // Log local player dead status at start of loop (only if player exists)
  if (localPlayerId && players[localPlayerId]) {
    // console.log(`[DEBUG] Loop Start: Local player ${localPlayerId} isDead: ${players[localPlayerId].isDead}`);
  }

  // --- Determine Camera Target ---
  let targetPlayerForCamera = null;
  let targetReason = "No target"; // For logging

  if (spectatingPlayerId && players[spectatingPlayerId] && !players[spectatingPlayerId].isDead) {
    targetPlayerForCamera = players[spectatingPlayerId];
    targetReason = `Spectating ${spectatingPlayerId}`;
  } else if (localPlayerId && players[localPlayerId] && !players[localPlayerId].isDead) {
    targetPlayerForCamera = players[localPlayerId];
    targetReason = `Following local ${localPlayerId}`;
    if (spectatingPlayerId !== null) {
      console.log("[DEBUG] Stopped spectating, following self.");
      spectatingPlayerId = null; // Explicitly ensure null if following self
    }
  } else if (localPlayerId && players[localPlayerId] && players[localPlayerId].isDead) {
    const alivePlayers = Object.values(players).filter((p) => !p.isDead);
    if (alivePlayers.length > 0) {
      targetPlayerForCamera = alivePlayers[0];
      spectatingPlayerId = alivePlayers[0].id; // Update spectating target
      targetReason = `Local dead, spectating alternative ${spectatingPlayerId}`;
    } else {
      targetReason = "Local dead, no one else alive";
    }
  }
  // Log the determined target each frame for debugging
  // console.log(`[DEBUG] Camera Target Reason: ${targetReason}`);

  // --- Update Camera (Lerp) ---
  if (targetPlayerForCamera) {
    // Calculate target camera position (centered on the target player)
    const targetCameraX = targetPlayerForCamera.x - canvas.width / 2 + 10;
    const targetCameraY = targetPlayerForCamera.y - canvas.height / 2 + 10;

    // Interpolate camera position
    cameraX += (targetCameraX - cameraX) * LERP_FACTOR;
    cameraY += (targetCameraY - cameraY) * LERP_FACTOR;
  } else {
    // Optional: If no target, smoothly return camera to origin or keep static
    // cameraX += (0 - cameraX) * LERP_FACTOR * 0.1; // Slow drift to 0,0
    // cameraY += (0 - cameraY) * LERP_FACTOR * 0.1;
  }

  // Clear the canvas
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // --- Draw stars (fixed to camera) ---
  const now = Date.now();
  stars.forEach((star) => {
    // Calculate star brightness (blinking effect)
    const brightness = Math.sin(now * star.blinkRate + star.blinkOffset) * 0.2 + 0.8;
    ctx.fillStyle = star.color;
    ctx.globalAlpha = brightness;

    // Draw repositioned stars (parallax effect)
    const parallaxFactor = star.size / 3; // Larger stars move more with camera
    const drawX = (((star.x + cameraX * parallaxFactor) % canvas.width) + canvas.width) % canvas.width;
    const drawY = (((star.y + cameraY * parallaxFactor) % canvas.height) + canvas.height) % canvas.height;

    ctx.beginPath();
    ctx.arc(drawX, drawY, star.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1.0;

  // Apply camera transform
  ctx.save();
  ctx.translate(-cameraX, -cameraY);

  // Draw platforms
  platforms.forEach((platform) => {
    drawPlatform(platform.x, platform.y, platform.width, platform.height);
  });

  // Draw bombs
  Object.values(bombs).forEach((bomb) => {
    drawBomb(bomb);
  });

  // Update and draw blood particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += GRAVITY * 0.1;
    p.life -= 1000 / 60;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life / PARTICLE_LIFESPAN);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  // Update and draw explosion particles
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const p = explosionParticles[i];
    p.x += p.vx;
    p.y += p.vy;

    if (p.type !== "light") {
      // Light doesn't move with gravity
      p.vy += GRAVITY * (p.type === "smoke" ? 0.02 : 0.05);
    }

    p.life -= 1000 / 60;

    if (p.life <= 0) {
      explosionParticles.splice(i, 1);
      continue;
    }

    // Different rendering for different particle types
    if (p.type === "light") {
      // Light flash
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life / 150;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - p.life / 150), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "smoke") {
      // Smoke
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.min(0.6, p.life / EXPLOSION_PARTICLE_LIFESPAN);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - (p.life / (EXPLOSION_PARTICLE_LIFESPAN + 500)) * 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "shrapnel") {
      // Shrapnel
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / EXPLOSION_PARTICLE_LIFESPAN);
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    } else {
      // Fire
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / EXPLOSION_PARTICLE_LIFESPAN);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1.0;

  // Draw projectiles
  Object.values(projectiles).forEach((projectile) => {
    drawProjectile(projectile);
  });

  // Draw all players
  Object.values(players).forEach((player) => {
    // Don't draw dead players
    if (player.isDead) return;

    // Draw player with indication if it's the local player
    drawPlayer(player, player.id === localPlayerId);
  });

  // Restore context
  ctx.restore();

  // --- Draw Screen-Fixed Elements (UI) ---

  // Draw enhanced kill feed instead of basic kill messages
  drawKillFeed();

  // Draw the game UI overlay
  drawGameUI();

  // --- Draw Respawn UI ---
  if (showRespawnButton) {
    const now = Date.now();
    const timeSinceDeath = now - respawnAnimationStartTime;

    // Fade in the background overlay
    respawnScreenAlpha = Math.min(1, timeSinceDeath / 600);

    // Fade in UI elements slightly later
    respawnElementsAlpha = timeSinceDeath > 300 ? Math.min(1, (timeSinceDeath - 300) / 600) : 0;

    // Reveal stats after a delay
    if (timeSinceDeath > 800 && !respawnStatsRevealed) {
      respawnStatsRevealed = true;
    }

    // Create pulsing and hover effects - Made smoother
    respawnAnimationTime += 1000 / 60;
    const pulseFactor = Math.sin(respawnAnimationTime / 800) * 0.03 + 1.0; // Reduced from 0.05 to 0.03, slower frequency
    const hoverScale = respawnButtonHovered ? 1.03 : 1.0; // Reduced from 1.05 to 1.03

    // Semi-transparent dark overlay with vignette effect
    ctx.fillStyle = THEME.respawnBackground;
    ctx.globalAlpha = respawnScreenAlpha;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw radial vignette
    const vignetteRadius = Math.max(canvas.width, canvas.height) * 0.8;
    const gradient = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, vignetteRadius);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.8)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = respawnElementsAlpha;

    // Death flash effect at the beginning
    if (timeSinceDeath < 300) {
      const flashOpacity = 1 - timeSinceDeath / 300;
      ctx.fillStyle = `rgba(255, 0, 0, ${flashOpacity * 0.5})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // "YOU DIED" text with smoother animation
    const fontSize = Math.min(90, canvas.width * 0.15);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Smoother text scaling
    const textScale =
      timeSinceDeath < 500
        ? 1.3 - (timeSinceDeath / 1000) * 0.3 // Reduced initial scale and overall effect
        : 1.0 + Math.sin(timeSinceDeath / 1500) * 0.02; // Slower, subtler pulsing

    // Text shadow glow
    const glowSize = 15 + Math.sin(timeSinceDeath / 500) * 3; // Reduced from 20+5 to 15+3
    ctx.shadowColor = "rgba(255, 0, 0, 0.7)";
    ctx.shadowBlur = glowSize;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Main text with animation
    ctx.fillStyle = THEME.respawnHeaderColor;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height * 0.25);
    ctx.scale(textScale, textScale);
    ctx.fillText("YOU DIED", 0, 0);
    ctx.restore();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Display spectating information
    if (spectatingPlayerId && players[spectatingPlayerId]) {
      const spectatingPlayer = players[spectatingPlayerId];
      ctx.font = "18px Arial";
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillText(`Spectating: ${spectatingPlayer.color}`, canvas.width / 2, canvas.height * 0.25 + fontSize / 2 + 30);
    }

    // Stats Panel with improved spacing
    if (respawnStatsRevealed) {
      const panelWidth = Math.min(500, canvas.width * 0.7);
      const panelHeight = 180; // Increased from 160 to 180
      const panelX = canvas.width / 2 - panelWidth / 2;
      const panelY = canvas.height * 0.4;
      const cornerRadius = 10;

      // Panel background with blur effect (fake blur with semi-transparent panel)
      ctx.fillStyle = THEME.respawnPanelBackground;
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelWidth, panelHeight, cornerRadius);
      ctx.fill();

      // Panel border
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Stats content
      ctx.fillStyle = THEME.respawnTextColor;
      ctx.font = "bold 18px Arial";
      ctx.textAlign = "center";
      ctx.fillText("BATTLE STATS", canvas.width / 2, panelY + 30);

      // Divider line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.beginPath();
      ctx.moveTo(panelX + 30, panelY + 50);
      ctx.lineTo(panelX + panelWidth - 30, panelY + 50);
      ctx.stroke();

      // Stats with improved spacing
      const statsX1 = panelX + panelWidth * 0.25;
      const statsX2 = panelX + panelWidth * 0.75;
      const statsY = panelY + 85; // Shifted up slightly
      const statSpacing = 45; // Increased from 35 to 45

      ctx.textAlign = "center";
      ctx.font = "16px Arial";

      // Left column stats
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fillText("KILLS", statsX1, statsY);
      ctx.fillText("DEATHS", statsX1, statsY + statSpacing);

      // Right column stats
      ctx.fillText("K/D RATIO", statsX2, statsY);
      ctx.fillText("LIFETIME DAMAGE", statsX2, statsY + statSpacing);

      // Stat values with improved spacing
      ctx.font = "bold 24px Arial"; // Increased from 20px to 24px
      ctx.fillStyle = THEME.respawnAccentColor;

      // Calculate and format K/D ratio
      const kdRatio = playerStats.deaths > 0 ? (playerStats.kills / playerStats.deaths).toFixed(2) : playerStats.kills.toFixed(2);

      // Example lifetime damage
      const lifetimeDamage = playerStats.kills * 100;

      // Draw stat values with more space between label and value
      ctx.fillText(playerStats.kills.toString(), statsX1, statsY + 30);
      ctx.fillText(playerStats.deaths.toString(), statsX1, statsY + statSpacing + 30);
      ctx.fillText(kdRatio, statsX2, statsY + 30);
      ctx.fillText(lifetimeDamage.toString(), statsX2, statsY + statSpacing + 30);
    }

    // Respawn Button - calculate dimensions and position - smoother animations
    const buttonScale = hoverScale * pulseFactor;
    const buttonWidth = Math.min(240, canvas.width * 0.3) * buttonScale;
    const buttonHeight = 70 * buttonScale;
    const buttonX = canvas.width / 2 - buttonWidth / 2;
    const buttonY = canvas.height * 0.7 - buttonHeight / 2;

    // Button gradient - different when hovered
    const buttonGradient = ctx.createLinearGradient(buttonX, buttonY, buttonX, buttonY + buttonHeight);
    const gradientColors = respawnButtonHovered ? THEME.respawnButtonHover : THEME.respawnButtonGradient;
    buttonGradient.addColorStop(0, gradientColors[0]);
    buttonGradient.addColorStop(1, gradientColors[1]);

    // Button shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;

    // Draw button background
    ctx.fillStyle = buttonGradient;
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 15);
    ctx.fill();

    // Button border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Button text with shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 5;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${Math.floor(28 * buttonScale)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RESPAWN", canvas.width / 2, buttonY + buttonHeight / 2);

    // Button highlight edge (top)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(buttonX + 15, buttonY + 3);
    ctx.lineTo(buttonX + buttonWidth - 15, buttonY + 3);
    ctx.stroke();

    // Add a subtle "click to respawn" text below the button
    ctx.font = "14px Arial";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText("Click to respawn", canvas.width / 2, buttonY + buttonHeight + 25);

    // Reset shadow and text settings
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1.0;

    // Update click handler position for the new button size
    respawnButtonBounds = {
      x: buttonX,
      y: buttonY,
      width: buttonWidth,
      height: buttonHeight,
    };
  }

  // --- Update Local Player Physics (Only if Alive) ---
  if (localPlayerId && players[localPlayerId] && !players[localPlayerId].isDead) {
    const player = players[localPlayerId];

    // Apply gravity *before* checking collision
    player.velocityY += GRAVITY;
    player.y += player.velocityY;

    // Move left/right (Only process if alive)
    if (keys.a) player.x -= 5;
    if (keys.d) player.x += 5;

    // Check if player is on a platform
    const isOnPlatform = checkPlatformCollision(player);

    // Handle jumping (Only process if alive)
    if (keys.space && isOnPlatform) {
      player.velocityY = JUMP_FORCE;
    }

    // Keep player in horizontal bounds (Removed left boundary check)
    player.x = Math.min(canvas.width - 20, player.x); // Keep right boundary for now
    // If you want to remove the right boundary too, comment out/delete the line above.

    // Emit movement to server (Only if alive)
    socket.emit("playerMove", {
      x: player.x,
      y: player.y,
      velocityY: player.velocityY,
      isJumping: !isOnPlatform, // True if not on platform (in air)
    });
  } else if (localPlayerId && players[localPlayerId] /* && players[localPlayerId].isDead */) {
    // Log if physics is skipped because player is dead
    // console.log("[DEBUG] Physics skipped for local player (dead).");
  }

  // Request next frame
  requestAnimationFrame(gameLoop);
}

// Start game loop
gameLoop();
