// Canvas setup
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Set canvas size
canvas.width = 800;
canvas.height = 600;

// Game state
let players = {};
let localPlayerId = null;

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

// Handle new player joining
socket.on("newPlayer", (playerData) => {
  players[playerData.id] = playerData;
  console.log("New player joined:", playerData);
});

// Handle player movement
socket.on("playerMoved", (playerData) => {
  if (players[playerData.id]) {
    players[playerData.id].x = playerData.x;
    players[playerData.id].y = playerData.y;
  }
});

// Handle player disconnection
socket.on("playerDisconnected", (playerId) => {
  delete players[playerId];
  console.log("Player disconnected:", playerId);
});

// Keyboard controls
const keys = {
  a: false,
  d: false,
};

// Handle keydown
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "a") keys.a = true;
  if (e.key.toLowerCase() === "d") keys.d = true;
});

// Handle keyup
document.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "a") keys.a = false;
  if (e.key.toLowerCase() === "d") keys.d = false;
});

// Game loop
function gameLoop() {
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Update local player position
  if (localPlayerId && players[localPlayerId]) {
    const player = players[localPlayerId];

    // Move left/right
    if (keys.a) player.x -= 5;
    if (keys.d) player.x += 5;

    // Keep player in bounds
    player.x = Math.max(0, Math.min(canvas.width - 20, player.x));

    // Emit movement to server
    socket.emit("playerMove", {
      x: player.x,
      y: player.y,
    });
  }

  // Draw all players
  Object.values(players).forEach((player) => {
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, 20, 20);
  });

  // Request next frame
  requestAnimationFrame(gameLoop);
}

// Start game loop
gameLoop();
