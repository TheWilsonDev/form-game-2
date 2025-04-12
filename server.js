const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// Serve static files from public directory
app.use(express.static("public"));

// Store all connected players
const players = {};

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("a user connected");

  // Generate a unique ID for the player
  const playerId = socket.id;

  // Add new player to the players object
  players[playerId] = {
    x: 100,
    y: 100,
    color: getRandomColor(),
  };

  // Send the current players list and the new player's ID to the connecting client
  socket.emit("currentPlayers", players);
  socket.emit("playerId", playerId);

  // Broadcast the new player to all other clients
  socket.broadcast.emit("newPlayer", {
    id: playerId,
    ...players[playerId],
  });

  // Handle player movement
  socket.on("playerMove", (movement) => {
    if (players[playerId]) {
      players[playerId].x = movement.x;
      players[playerId].y = movement.y;
      // Broadcast the movement to all other clients
      socket.broadcast.emit("playerMoved", {
        id: playerId,
        x: movement.x,
        y: movement.y,
      });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("user disconnected");
    delete players[playerId];
    // Broadcast the disconnection to all other clients
    io.emit("playerDisconnected", playerId);
  });
});

// Helper function to generate random colors
function getRandomColor() {
  const colors = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Start the server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
