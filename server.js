import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from 'socket.io';
import ACTIONS from './Actions.js';
import dotenv from "dotenv"

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
dotenv.config();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["*"], // you can replace with your frontend domain later
        methods: ["GET", "POST"]
    }
});

// Serve static files from the dist folder (Vite build output)
app.use(express.static('dist'));
app.get('*', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const userSocketMap = {};
const roomQuestions = {};  // 🆕 cache for each room

function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => ({
            socketId,
            username: userSocketMap[socketId],
        })
    );
}

io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
        userSocketMap[socket.id] = username;
        socket.join(roomId);

        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit(ACTIONS.JOINED, {
                clients,
                username,
                socketId: socket.id,
            });
        });

        // 🆕 Send cached question if available
        if (roomQuestions[roomId]) {
            io.to(socket.id).emit(ACTIONS.QUESTION_CHANGE, {
                question: roomQuestions[roomId],
            });
        }
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
        io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.QUESTION_CHANGE, ({ roomId, question }) => {
        // 🆕 Save question in memory for this room
        roomQuestions[roomId] = question;

        // send to others in the room
        socket.in(roomId).emit(ACTIONS.QUESTION_CHANGE, { question });
    });

    // 🆕 SYNC_QUESTION not needed anymore, handled in JOIN above
    // You can delete this, unless you want redundancy

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                socketId: socket.id,
                username: userSocketMap[socket.id],
            });
        });
        delete userSocketMap[socket.id];
        socket.leave();
    });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));