# Block Brawl - Multiplayer Movement MVP

## Backend Setup (`server.js`)

- [x] Initialize Express server
- [x] Serve static files from `public` directory
- [x] Initialize Socket.IO
- [x] Create players state object
- [x] Handle socket connections:
  - [x] Assign unique player ID
  - [x] Add player to state
  - [x] Send initial state to new player
  - [x] Broadcast new player to others
- [x] Handle player movement:
  - [x] Listen for 'playerMove' events
  - [x] Update player position
  - [x] Broadcast updates to all clients
- [x] Handle player disconnections:
  - [x] Remove player from state
  - [x] Broadcast disconnect to others

## Frontend Setup (`public/index.html`)

- [x] Create basic HTML structure
- [x] Add canvas element
- [x] Include Socket.IO client
- [x] Include game.js

## Game Logic (`public/game.js`)

- [x] Get canvas context
- [x] Connect to Socket.IO server
- [x] Store local player ID
- [x] Store players state object
- [x] Handle server events:
  - [x] Initial state/ID
  - [x] New players
  - [x] Player movements
  - [x] Player disconnections
- [x] Add keyboard controls:
  - [x] A/D key listeners
  - [x] Emit movement events
- [x] Create game loop:
  - [x] Clear canvas
  - [x] Draw all players

## Basic Styling (`public/style.css`)

- [x] Style canvas element
- [x] Make canvas visible and centered

## Testing

- [ ] Test single player movement
- [ ] Test two players in different browsers
- [ ] Verify position syncing
- [ ] Test player disconnection handling
