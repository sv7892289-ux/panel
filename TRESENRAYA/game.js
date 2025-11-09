// --- Configuración de Firebase ---
const firebaseConfig = {
    apiKey: "AIzaSyDjSsmrOT7huC-HBZIiM3FkrjBBkw-TVGQ",
    authDomain: "proyecto-3-en-raya.firebaseapp.com",
    projectId: "proyecto-3-en-raya",
    storageBucket: "proyecto-3-en-raya.appspot.com",
    messagingSenderId: "252069733137",
    appId: "1:252069733137:web:b8b96d435700e1c49962b0"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Variables globales
window.auth = firebase.auth();
window.db = firebase.firestore();
window.firebase = firebase;
window.currentUser = null;

// Variables del juego
let gameBoard = ['', '', '', '', '', '', '', '', ''];
let currentPlayer = 'X';
let gameActive = true;
let gameMode = 'cpu';
let difficulty = 'medium';
let playerSymbol = 'X';
let cpuSymbol = 'O';

// Clase principal del juego
class GameManager {
    constructor() {
        this.initialized = false;
        this.eventListeners = new Map(); // Para rastrear event listeners
        this.currentRoomId = null;
        this.isHost = false;
        this.playerRole = null;
        this.roomRef = null;
        this.playerJoinedNotified = false;
        this.chatRef = null;
        this.movesRef = null;
        this.gameHistoryRef = null;
        this.init();
    }

    init() {
        if (this.initialized) return;
        
        console.log('🎮 Inicializando GameManager...');
        
        // Detectar estado de autenticación
        window.auth.onAuthStateChanged((user) => {
            if (user) {
                console.log("✅ Usuario autenticado:", user.uid);
                window.currentUser = user;
                this.loadPlayerData(user, true);
                this.subscribeToPlayerData(user);
            } else {
                console.log("❌ Ningún usuario autenticado");
                window.currentUser = null;
                this.showScreen('registration-screen');
            }
        });

        this.setupEventListeners();
        this.checkForRoomParameter();
        this.initialized = true;
        console.log('✅ GameManager inicializado correctamente');
    }

    // Función para limpiar event listeners anteriores
    removeEventListener(element, event, key) {
        if (this.eventListeners.has(key)) {
            const oldHandler = this.eventListeners.get(key);
            element.removeEventListener(event, oldHandler);
        }
    }

    // Función para limpiar salas antiguas
    async cleanupOldRooms() {
        try {
            const oneHourAgo = new Date(Date.now() - 3600000); // 1 hora
            const oldRoomsQuery = window.db.collection('rooms')
                .where('lastActivity', '<', oneHourAgo)
                .where('status', 'in', ['waiting', 'playing']);

            const snapshot = await oldRoomsQuery.get();
            
            const batch = window.db.batch();
            snapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    status: 'expired',
                    lastActivity: firebase.firestore.FieldValue.serverTimestamp()
                });
            });

            await batch.commit();
            console.log(`Limpiadas ${snapshot.size} salas antiguas`);
        } catch (error) {
            console.error('Error al limpiar salas antiguas:', error);
        }
    }

    // Función para agregar event listeners con seguimiento
    addEventListener(element, event, handler, key) {
        if (!element) return;
        
        this.removeEventListener(element, event, key);
        element.addEventListener(event, handler);
        this.eventListeners.set(key, handler);
    }

    setupEventListeners() {
        // Navegación entre pantallas
        this.addEventListener(
            document.getElementById('show-login'),
            'click',
            (e) => {
                e.preventDefault();
                this.showScreen('login-screen');
            },
            'show-login'
        );

        this.addEventListener(
            document.getElementById('show-registration'),
            'click',
            (e) => {
                e.preventDefault();
                this.showScreen('registration-screen');
            },
            'show-registration'
        );

        // Botones "Volver al Panel"
        const panelButtons = ['go-to-panel', 'go-to-panel-login', 'go-to-panel-catalog', 'back-to-panel', 'close-leaderboard'];
        panelButtons.forEach(id => {
            this.addEventListener(
                document.getElementById(id),
                'click',
                () => {
                    if (window.currentUser) {
                        this.showScreen('catalog');
                    } else {
                        this.showScreen('registration-screen');
                    }
                },
                id
            );
        });

        // Botón de juego
        this.addEventListener(
            document.getElementById('launch-game'),
            'click',
            () => {
                this.showScreen('game-area');
                document.getElementById('setup-screen').hidden = false;
                document.getElementById('game-tres-en-raya').hidden = true;
            },
            'launch-game'
        );

        // Configuración del juego
        this.addEventListener(
            document.getElementById('setup-form'),
            'submit',
            (e) => {
                e.preventDefault();
                this.startGame(e);
            },
            'setup-form'
        );

        // Mostrar/ocultar opciones según el modo
        document.querySelectorAll('input[name="mode"]').forEach((radio, index) => {
            this.addEventListener(
                radio,
                'change',
                (e) => {
                    const difficultyGroup = document.getElementById('difficulty-group');
                    const onlineGroup = document.getElementById('online-group');
                    
                    if (e.target.value === 'cpu') {
                        difficultyGroup.style.display = 'block';
                        onlineGroup.style.display = 'none';
                    } else if (e.target.value === 'online') {
                        difficultyGroup.style.display = 'none';
                        onlineGroup.style.display = 'block';
                    } else {
                        difficultyGroup.style.display = 'none';
                        onlineGroup.style.display = 'none';
                    }
                },
                `mode-radio-${index}`
            );
        });

        // Funcionalidad para juego en línea
        this.setupOnlineGameListeners();
        
        // Configurar chat
        this.setupChatListeners();

        // Botón de tabla de líderes
        this.addEventListener(
            document.getElementById('leaderboard-btn'),
            'click',
            () => {
                this.showScreen('leaderboard-screen');
                this.loadLeaderboard();
            },
            'leaderboard-btn'
        );

        // Cerrar sesión
        this.addEventListener(
            document.getElementById('logout-btn'),
            'click',
            async () => {
                try {
                    await window.auth.signOut();
                    alert("Sesión cerrada.");
                    this.showScreen('registration-screen');
                } catch (error) {
                    console.error("Error al cerrar sesión:", error);
                    alert("Error al cerrar sesión.");
                }
            },
            'logout-btn'
        );

        // Botón volver del juego
        this.addEventListener(
            document.getElementById('back'),
            'click',
            () => {
                this.cleanupOnlineGame();
                window.location.href = 'catalog.html';
            },
            'back'
        );

        // Registro
        this.addEventListener(
            document.getElementById('player-registration-form'),
            'submit',
            async (e) => {
                e.preventDefault();
                await this.handleRegistration(e);
            },
            'registration-form'
        );

        // Login
        this.addEventListener(
            document.getElementById('player-login-form'),
            'submit',
            async (e) => {
                e.preventDefault();
                await this.handleLogin(e);
            },
            'login-form'
        );

        // Controles del juego
        this.addEventListener(
            document.getElementById('reset'),
            'click',
            () => this.resetGame(),
            'reset'
        );

        this.addEventListener(
            document.getElementById('home'),
            'click',
            () => {
                // Limpiar juego en línea antes de salir
                this.cleanupOnlineGame();
                
                // Refrescar estadísticas antes de ir al catálogo
                if (window.currentUser) {
                    this.loadPlayerData(window.currentUser, false);
                }
                window.location.href = 'catalog.html';
            },
            'home'
        );
    }

    // Función para mostrar pantallas
    showScreen(screenId) {
        const screens = ['registration-screen', 'login-screen', 'catalog', 'game-area', 'leaderboard-screen'];
        screens.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        });
        
        const targetEl = document.getElementById(screenId);
        if (targetEl) {
            targetEl.hidden = false;
        }
    }

    // Cargar datos del jugador
    async loadPlayerData(user, shouldSwitchScreen = false) {
        try {
            const doc = await window.db.collection("players").doc(user.uid).get();
            if (doc.exists) {
                const data = doc.data();
                const welcomeEl = document.getElementById('welcome-player');
                const gamesPlayedEl = document.getElementById('games-played');
                const gamesWonEl = document.getElementById('games-won');
                const winPercentageEl = document.getElementById('win-percentage');

                if (welcomeEl) welcomeEl.textContent = data.name || "Jugador";
                if (gamesPlayedEl) gamesPlayedEl.textContent = data.gamesPlayed || 0;
                if (gamesWonEl) gamesWonEl.textContent = data.gamesWon || 0;
                
                const winPercentage = data.gamesPlayed > 0 ? Math.round((data.gamesWon / data.gamesPlayed) * 100) : 0;
                if (winPercentageEl) winPercentageEl.textContent = winPercentage + '%';
                
                if (shouldSwitchScreen) {
                    this.showScreen('catalog');
                }
            } else {
                console.log("Documento del jugador no encontrado");
                if (shouldSwitchScreen) this.showScreen('registration-screen');
            }
        } catch (error) {
            console.error("Error al cargar datos:", error);
            this.showScreen('registration-screen');
        }
    }
    
    // Suscribirse a cambios del jugador
    subscribeToPlayerData(user) {
        window.db.collection("players").doc(user.uid).onSnapshot((doc) => {
            if (doc.exists) {
                this.loadPlayerData(user, false);
            }
        });
    }

    // Inicializar el juego
    startGame(e) {
        const formData = new FormData(e.target);
        playerSymbol = formData.get('symbol') || 'X';
        cpuSymbol = playerSymbol === 'X' ? 'O' : 'X';
        gameMode = formData.get('mode') || 'cpu';
        difficulty = document.getElementById('difficulty').value || 'medium';
        
        // Manejar modo en línea
        if (gameMode === 'online') {
            const onlineAction = formData.get('online-action');
            if (onlineAction === 'create') {
                this.createOnlineRoom();
            } else if (onlineAction === 'join') {
                const roomId = document.getElementById('room-id').value.trim();
                if (roomId.length === 6) {
                    this.joinOnlineRoom(roomId);
                } else {
                    alert('Por favor ingresa un ID de sala válido de 6 caracteres.');
                    return;
                }
            }
        } else {
            this.startLocalGame();
        }
    }

    // Iniciar juego local
    startLocalGame() {
        // En modo 2 jugadores, siempre empezar con X
        // En modo CPU, empezar con el símbolo del jugador
        if (gameMode === '2p') {
            currentPlayer = 'X';
        } else {
            currentPlayer = playerSymbol;
        }
        
        gameBoard = ['', '', '', '', '', '', '', '', ''];
        gameActive = true;
        
        document.getElementById('setup-screen').hidden = true;
        document.getElementById('game-tres-en-raya').hidden = false;
        
        // Ocultar chat en modo local
        this.hideChat();
        
        this.initializeGameBoard();
        this.updateBoard();
        this.updateStatus();
        
        // Mostrar mensaje de quién empieza primero
        this.showGameStartMessage();
    }

    // Mostrar mensaje de inicio del juego
    showGameStartMessage() {
        let message = '';
        
        if (gameMode === 'cpu') {
            const playerName = document.getElementById('player-name')?.value || 'Jugador';
            message = `¡${playerName} empieza primero con ${playerSymbol}!`;
        } else if (gameMode === '2p') {
            const playerName = document.getElementById('player-name')?.value || 'Jugador 1';
            message = `¡${playerName} empieza primero con X! El segundo jugador será O.`;
        } else if (gameMode === 'online') {
            message = `¡El juego ha comenzado! ${this.isHost ? 'Eres el anfitrión' : 'Eres el invitado'}.`;
        }
        
        if (message) {
            alert(message);
        }
    }

    // Crear sala en línea
    createOnlineRoom() {
        const roomId = this.generateRoomId();
        if (!roomId) {
            alert('Error: No se pudo generar el ID de la sala.');
            return;
        }

        // Guardar la sala en Firestore con más metadatos
        const roomData = {
            roomId: roomId,  // Agregar el ID explícitamente
            board: ['', '', '', '', '', '', '', '', ''],
            turn: 'X',
            player1: window.currentUser.uid,
            player2: null,
            player1Symbol: 'X',
            player2Symbol: 'O',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'waiting', // waiting, playing, finished
            version: '1.0',    // Para futuras actualizaciones
            gameMode: 'online',
            isPublic: true,    // Para futura funcionalidad de salas privadas
            expiresAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        window.db.collection("rooms").doc(roomId).set(roomData)
            .then(() => {
                console.log(`✅ Sala creada: ${roomId}`);
                this.currentRoomId = roomId;
                this.isHost = true;
                this.playerRole = 'host';
                this.roomRef = window.db.collection("rooms").doc(roomId);

                // Mostrar enlace para compartir
                const shareLink = `${window.location.origin + window.location.pathname}?room=${roomId}`;
                document.getElementById('room-link').value = shareLink;

                // Escuchar cambios en la sala
                this.listenToRoom();

                // Iniciar juego en línea
                this.startOnlineGame(roomId, 'host');
            })
            .catch(error => {
                console.error("❌ Error al crear sala:", error);
                alert("Error al crear la sala. Por favor, intenta nuevamente.");
            });
    }

    // Unirse a sala en línea
    joinOnlineRoom(roomId) {
        window.db.collection("rooms").doc(roomId).get()
            .then(doc => {
                if (!doc.exists) {
                    alert('La sala no existe.');
                    return;
                }

                const data = doc.data();
                if (data.status !== 'waiting') {
                    alert('La sala ya está en juego.');
                    return;
                }

                if (data.player2) {
                    alert('La sala ya tiene 2 jugadores.');
                    return;
                }

                // Actualizar la sala con el segundo jugador
                window.db.collection("rooms").doc(roomId).update({
                    player2: window.currentUser.uid,
                    status: 'playing'
                })
                .then(() => {
                    console.log(`✅ Unido a sala: ${roomId}`);
                    this.currentRoomId = roomId;
                    this.isHost = false;
                    this.playerRole = 'guest';
                    this.roomRef = window.db.collection("rooms").doc(roomId);

                    // Escuchar cambios en la sala
                    this.listenToRoom();

                    // Cargar el estado de la sala
                    this.loadRoomState(data);

                    // Iniciar juego en línea
                    this.startOnlineGame(roomId, 'guest');
                })
                .catch(error => {
                    console.error("❌ Error al unirse a sala:", error);
                    alert("Error al unirse a la sala. Por favor, intenta nuevamente.");
                });
            })
            .catch(error => {
                console.error("❌ Error al obtener sala:", error);
                alert("Error al obtener la sala. Por favor, verifica el ID e intenta nuevamente.");
            });
    }

    // Escuchar cambios en la sala
    listenToRoom() {
        if (!this.roomRef) return;

        this.roomRef.onSnapshot((doc) => {
            if (!doc.exists) {
                console.log("❌ La sala ya no existe");
                this.showScreen('catalog');
                return;
            }

            const data = doc.data();
            this.loadRoomState(data);
        }, (error) => {
            console.error("❌ Error al escuchar sala:", error);
        });
    }

    // Cargar el estado de la sala
    loadRoomState(data) {
        if (!data) return;

        // Verificar si un jugador se unió
        if (data.player2 && !this.playerJoinedNotified) {
            this.addChatMessage('system', `¡Jugador se unió a la sala ${this.currentRoomId}!`);
            this.playerJoinedNotified = true;
            
            // Habilitar el botón de inicio para ambos jugadores
            document.getElementById('start-game-btn').disabled = false;
            
            // Si somos el host y se unió el segundo jugador, actualizar el historial
            if (this.isHost && this.currentGameHistoryId) {
                this.gameHistoryRef.doc(this.currentGameHistoryId).update({
                    player2: data.player2,
                    status: 'ready'
                });
            }
            
            // Mostrar mensaje de que la sala está lista
            document.getElementById('waiting-message').style.display = 'none';
            document.getElementById('ready-message').style.display = 'block';
        }

        // Verificar si el juego terminó
        if (data.status === 'finished') {
            gameActive = false;
            this.addChatMessage('system', 'La partida ha terminado');
            return;
        }

        // Actualizar el tablero
        gameBoard = data.board || ['', '', '', '', '', '', '', '', ''];
        currentPlayer = data.turn || 'X';

        // Determinar el símbolo del jugador actual
        if (this.isHost) {
            playerSymbol = data.player1Symbol || 'X';
            cpuSymbol = data.player2Symbol || 'O';
        } else {
            playerSymbol = data.player2Symbol || 'O';
            cpuSymbol = data.player1Symbol || 'X';
        }

        // Actualizar el estado del juego
        gameActive = data.status === 'playing';

        // Actualizar la UI
        this.updateBoard();
        this.updateStatus();

        // Mostrar información del turno
        const isMyTurn = (this.playerRole === 'host' && currentPlayer === 'X') || 
                         (this.playerRole === 'guest' && currentPlayer === 'O');
        
        if (!isMyTurn && gameActive) {
            this.addChatMessage('system', 'Es turno del otro jugador...');
        }
    }

    // Iniciar juego en línea
    startOnlineGame(roomId, role) {
        // Ya se ha cargado el estado de la sala en loadRoomState
        this.initializeGameBoard();
        this.updateBoard();
        this.updateStatus();
        
        // Mostrar chat en modo en línea
        this.showChat();
        this.initializeChat();
        this.initializeOnlineChat(roomId);
        
        // Inicializar referencias para guardar movimientos
        this.initializeGameHistory(roomId);
        
        // Agregar mensaje de bienvenida al chat
        this.addChatMessage('system', `Sala ${roomId} - ${role === 'host' ? 'Anfitrión' : 'Invitado'}`);
        
        // Mostrar información de la sala
        this.showRoomInfo(roomId, role);
        
        // Mostrar mensaje de inicio del juego
        this.showGameStartMessage();
    }

    // Inicializar tablero del juego
    initializeGameBoard() {
        const cells = document.querySelectorAll('.cell');
        cells.forEach((cell, index) => {
            // Limpiar event listeners anteriores
            this.removeEventListener(cell, 'click', `cell-${index}`);
            
            // Agregar nuevo event listener
            this.addEventListener(
                cell,
                'click',
                () => this.handleCellClick(index),
                `cell-${index}`
            );
        });
    }

    handleCellClick(index) {
        if (gameBoard[index] !== '' || !gameActive) return;

        // Verificar turnos solo en modo en línea
        if (gameMode === 'online') {
            const isMyTurn = (this.playerRole === 'host' && currentPlayer === 'X') || 
                              (this.playerRole === 'guest' && currentPlayer === 'O');

            if (!isMyTurn) {
                alert("No es tu turno.");
                return;
            }
        } else if (gameMode === 'cpu') {
            // En modo CPU, verificar que sea turno del jugador humano
            if (currentPlayer !== playerSymbol) {
                alert("No es tu turno.");
                return;
            }
        }
        // En modo 2 jugadores, ambos pueden jugar alternadamente, no hay restricción

        // Guardar movimiento antes de hacerlo (solo en modo en línea)
        if (gameMode === 'online') {
            this.saveMove(index, currentPlayer);
        }

        // Hacer el movimiento
        gameBoard[index] = currentPlayer;
        this.updateBoard();

        // Verificar si hay ganador
        if (this.checkWinner()) {
            const isWin = currentPlayer === playerSymbol;
            document.getElementById('status').textContent = `¡${currentPlayer} gana!`;
            gameActive = false;
            this.updateStats(isWin ? 'win' : 'lose');
            
            // Guardar resultado del juego (solo en modo en línea)
            if (gameMode === 'online') {
                this.saveGameResult(currentPlayer, 'win');
                
                // Actualizar el estado de la sala
                this.roomRef.update({
                    board: gameBoard,
                    turn: currentPlayer,
                    status: 'finished'
                });
            }

            setTimeout(() => {
                const statusEl = document.getElementById('status');
                if (statusEl) {
                    statusEl.textContent = `¡${currentPlayer} gana! Estadísticas actualizadas.`;
                }
            }, 1000);
            return;
        }

        // Verificar si hay empate
        if (gameBoard.every(cell => cell !== '')) {
            document.getElementById('status').textContent = '¡Empate!';
            gameActive = false;
            this.updateStats('draw');
            
            // Guardar resultado del juego (solo en modo en línea)
            if (gameMode === 'online') {
                this.saveGameResult('tie', 'draw');
                
                // Actualizar el estado de la sala
                this.roomRef.update({
                    board: gameBoard,
                    turn: currentPlayer,
                    status: 'finished'
                });
            }

            setTimeout(() => {
                const statusEl = document.getElementById('status');
                if (statusEl) {
                    statusEl.textContent = '¡Empate! Estadísticas actualizadas.';
                }
            }, 1000);
            return;
        }

        // Cambiar turno
        currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
        this.updateStatus();

        // Actualizar el estado de la sala en Firestore (solo en modo en línea)
        if (gameMode === 'online' && this.roomRef) {
            this.roomRef.update({
                board: gameBoard,
                turn: currentPlayer
            });
        }

        // Si es modo CPU y ahora es turno de la CPU, hacer movimiento automático
        if (gameMode === 'cpu' && currentPlayer === cpuSymbol) {
            setTimeout(() => {
                this.cpuMove();
            }, 500); // Pequeña pausa para que se vea el cambio de turno
        }
    }

    cpuMove() {
        if (!gameActive) return;

        let move;
        switch (difficulty) {
            case 'easy':
                move = this.getRandomMove();
                break;
            case 'medium':
                move = Math.random() < 0.7 ? this.getBestMove() : this.getRandomMove();
                break;
            case 'hard':
                move = this.getBestMove();
                break;
        }

        if (move !== -1) {
            this.handleCellClick(move);
        }
    }

    getRandomMove() {
        const availableMoves = gameBoard.map((cell, index) => cell === '' ? index : null).filter(val => val !== null);
        return availableMoves.length > 0 ? availableMoves[Math.floor(Math.random() * availableMoves.length)] : -1;
    }

    getBestMove() {
        let bestScore = -Infinity;
        let bestMove = -1;

        for (let i = 0; i < 9; i++) {
            if (gameBoard[i] === '') {
                gameBoard[i] = cpuSymbol;
                let score = this.minimax(gameBoard, 0, false);
                gameBoard[i] = '';
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = i;
                }
            }
        }
        return bestMove;
    }

    minimax(board, depth, isMaximizing) {
        let result = this.checkWinnerForMinimax();
        if (result !== null) {
            return result === cpuSymbol ? 1 : result === playerSymbol ? -1 : 0;
        }

        if (isMaximizing) {
            let bestScore = -Infinity;
            for (let i = 0; i < 9; i++) {
                if (board[i] === '') {
                    board[i] = cpuSymbol;
                    let score = this.minimax(board, depth + 1, false);
                    board[i] = '';
                    bestScore = Math.max(score, bestScore);
                }
            }
            return bestScore;
        } else {
            let bestScore = Infinity;
            for (let i = 0; i < 9; i++) {
                if (board[i] === '') {
                    board[i] = playerSymbol;
                    let score = this.minimax(board, depth + 1, true);
                    board[i] = '';
                    bestScore = Math.min(score, bestScore);
                }
            }
            return bestScore;
        }
    }

    checkWinner() {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // Filas
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columnas
            [0, 4, 8], [2, 4, 6] // Diagonales
        ];

        return winPatterns.some(pattern => {
            const [a, b, c] = pattern;
            return gameBoard[a] && gameBoard[a] === gameBoard[b] && gameBoard[a] === gameBoard[c];
        });
    }

    checkWinnerForMinimax() {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        for (let pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (gameBoard[a] && gameBoard[a] === gameBoard[b] && gameBoard[a] === gameBoard[c]) {
                return gameBoard[a];
            }
        }

        return gameBoard.every(cell => cell !== '') ? 'tie' : null;
    }

    updateBoard() {
        const cells = document.querySelectorAll('.cell');
        cells.forEach((cell, index) => {
            cell.textContent = gameBoard[index];
            cell.style.color = gameBoard[index] === 'X' ? '#e74c3c' : '#3498db';
        });
    }

    updateStatus() {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = `Turno de ${currentPlayer}`;
        }
    }

    resetGame() {
        // Verificar si estamos en modo en línea
        if (gameMode === 'online' && this.currentRoomId && this.roomRef) {
            // Resetear juego en línea
            const resetData = {
                board: ['', '', '', '', '', '', '', '', ''],
                turn: 'X',
                status: 'playing'
            };
            
            this.roomRef.update(resetData)
                .then(() => {
                    console.log('✅ Juego reiniciado en línea');
                    this.addChatMessage('system', 'El juego ha sido reiniciado');
                })
                .catch(error => {
                    console.error('❌ Error al reiniciar juego en línea:', error);
                    alert('Error al reiniciar el juego. Intenta nuevamente.');
                });
        } else {
            // Resetear juego local
            gameBoard = ['', '', '', '', '', '', '', '', ''];
            currentPlayer = playerSymbol;
            gameActive = true;
            this.updateBoard();
            this.updateStatus();
        }
    }

    async updateStats(result) {
        if (!window.currentUser) return;

        try {
            const playerRef = window.db.collection("players").doc(window.currentUser.uid);
            const doc = await playerRef.get();
            
            if (doc.exists) {
                const data = doc.data();
                const newGamesPlayed = (data.gamesPlayed || 0) + 1;
                const newGamesWon = result === 'win' ? (data.gamesWon || 0) + 1 : (data.gamesWon || 0);
                const newWinPercentage = Math.round((newGamesWon / newGamesPlayed) * 100);

                await playerRef.update({
                    gamesPlayed: newGamesPlayed,
                    gamesWon: newGamesWon,
                    winPercentage: newWinPercentage
                });

                // Actualizar la interfaz de usuario inmediatamente
                this.updateStatsUI(newGamesPlayed, newGamesWon, newWinPercentage);
                
                // Debug: mostrar estadísticas actualizadas
                console.log(`Estadísticas actualizadas: ${newGamesPlayed} partidas, ${newGamesWon} victorias, ${newWinPercentage}%`);
            }
        } catch (error) {
            console.error("Error al actualizar estadísticas:", error);
        }
    }

    // Actualizar la interfaz de usuario con las nuevas estadísticas
    updateStatsUI(gamesPlayed, gamesWon, winPercentage) {
        const gamesPlayedEl = document.getElementById('games-played');
        const gamesWonEl = document.getElementById('games-won');
        const winPercentageEl = document.getElementById('win-percentage');

        if (gamesPlayedEl) gamesPlayedEl.textContent = gamesPlayed;
        if (gamesWonEl) gamesWonEl.textContent = gamesWon;
        if (winPercentageEl) winPercentageEl.textContent = winPercentage + '%';

        // Calcular derrotas y empates
        const gamesLost = gamesPlayed - gamesWon;
        const gamesDraw = 0; // Por ahora no contamos empates como derrotas

        // También actualizar las estadísticas en el juego
        const statsEl = document.getElementById('stats');
        if (statsEl) {
            statsEl.textContent = `Estadísticas: ${gamesWon}V | ${gamesDraw}E | ${gamesLost}D`;
        }
    }

    // Registro
    async handleRegistration(e) {
        const name = document.getElementById('player-name-reg').value.trim();
        const email = document.getElementById('player-email').value.trim();
        const password = document.getElementById('player-password').value;

        if (!name || !email || !password) {
            alert("Por favor completa todos los campos.");
            return;
        }

        try {
            const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            await window.db.collection("players").doc(user.uid).set({
                name: name,
                email: email,
                gamesPlayed: 0,
                gamesWon: 0,
                winPercentage: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            alert("✅ Registro exitoso. ¡Bienvenido!");

        } catch (error) {
            console.error("Error en registro:", error);
            let msg = "Error: ";
            if (error.code === 'auth/email-already-in-use') {
                msg += "El correo ya está registrado.";
            } else if (error.code === 'auth/invalid-email') {
                msg += "Correo inválido.";
            } else if (error.code === 'auth/weak-password') {
                msg += "La contraseña debe tener al menos 6 caracteres.";
            } else {
                msg += error.message;
            }
            alert(msg);
        }
    }

    // Login
    async handleLogin(e) {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        if (!email || !password) {
            alert("Por favor completa todos los campos.");
            return;
        }

        try {
            await window.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            await window.auth.signInWithEmailAndPassword(email, password);
            
        } catch (error) {
            console.error("Error en login:", error);
            let msg = "Error: ";
            if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                msg += "Correo o contraseña incorrectos.";
            } else if (error.code === 'auth/invalid-email') {
                msg += "Correo inválido.";
            } else {
                msg += error.message;
            }
            alert(msg);
        }
    }

    // Tabla de líderes
    async loadLeaderboard() {
        const list = document.getElementById('leaderboard-list');
        if (!list) return;
        
        list.innerHTML = '<p>Cargando...</p>';

        try {
            const snapshot = await window.db.collection("players")
                .orderBy("gamesWon", "desc")
                .limit(10)
                .get();

            list.innerHTML = '';
            let rank = 1;
            snapshot.forEach(doc => {
                const data = doc.data();
                const item = document.createElement('div');
                item.innerHTML = `
                    <div style="display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #eee;">
                        <span><strong>${rank}.</strong> ${data.name}</span>
                        <span>${data.gamesWon} victorias</span>
                    </div>
                `;
                list.appendChild(item);
                rank++;
            });

            if (rank === 1) {
                list.innerHTML = '<p>No hay jugadores registrados aún.</p>';
            }
        } catch (error) {
            console.error("Error al cargar leaderboard:", error);
            list.innerHTML = '<p>Error al cargar la tabla de líderes.</p>';
        }
    }

    // Configurar listeners para juego en línea
    setupOnlineGameListeners() {
        // Cambiar entre crear y unirse a sala
        document.querySelectorAll('input[name="online-action"]').forEach((radio, index) => {
            this.addEventListener(
                radio,
                'change',
                async (e) => {
                    const roomIdGroup = document.getElementById('room-id-group');
                    const roomInfoGroup = document.getElementById('room-info-group');
                    
                    if (e.target.value === 'create') {
                        roomIdGroup.style.display = 'none';
                        roomInfoGroup.style.display = 'block';
                        await this.createNewRoom();
                    } else {
                        roomIdGroup.style.display = 'block';
                        roomInfoGroup.style.display = 'none';
                    }
                },
                `online-action-${index}`
            );
        });

        // Agregar listener para unirse a sala
        document.getElementById('join-room-btn').addEventListener('click', async () => {
            const roomId = document.getElementById('room-id-input').value;
            if (roomId) {
                await this.joinExistingRoom(roomId);
            }
        });

        // Generar ID de sala
        this.addEventListener(
            document.getElementById('generate-room-id'),
            'click',
            () => this.generateRoomId(),
            'generate-room-id'
        );

        // Copiar ID de sala
        this.addEventListener(
            document.getElementById('copy-room-id'),
            'click',
            () => this.copyToClipboard(document.getElementById('display-room-id').textContent),
            'copy-room-id'
        );

        // Copiar enlace de sala
        this.addEventListener(
            document.getElementById('copy-room-link'),
            'click',
            () => this.copyToClipboard(document.getElementById('room-link').value),
            'copy-room-link'
        );
    }

    // Generar ID de sala aleatorio
    generateRoomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let roomId = '';
        for (let i = 0; i < 6; i++) {
            roomId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const displayElement = document.getElementById('display-room-id');
        const linkElement = document.getElementById('room-link');
        
        if (displayElement) {
            displayElement.textContent = roomId;
        }
        
        if (linkElement) {
            // Usar URL absoluta basada en la ubicación actual
            const baseUrl = window.location.href.split('?')[0]; // Eliminar parámetros existentes
            linkElement.value = `${baseUrl}?room=${roomId}`;
        }
        
        return roomId;
    }

    // Copiar al portapapeles
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            alert('¡Copiado al portapapeles!');
        } catch (err) {
            // Fallback para navegadores que no soportan clipboard API
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('¡Copiado al portapapeles!');
        }
    }

    // Verificar si hay parámetros de sala en la URL
    async checkForRoomParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        
        if (roomId && roomId.length === 6) {
            try {
                // Verificar si la sala existe y está activa
                const roomRef = window.db.collection('rooms').doc(roomId);
                const roomDoc = await roomRef.get();
                
                if (!roomDoc.exists) {
                    console.log('La sala no existe:', roomId);
                    return;
                }
                
                const roomData = roomDoc.data();
                if (roomData.status === 'expired' || roomData.status === 'finished') {
                    console.log('La sala ya no está activa:', roomId);
                    return;
                }
                
                // Si la sala existe y está activa, seleccionar "Unirse a Sala"
                const joinRadio = document.querySelector('input[name="online-action"][value="join"]');
                const createRadio = document.querySelector('input[name="online-action"][value="create"]');
                const onlineMode = document.querySelector('input[name="mode"][value="online"]');
            
            if (joinRadio && createRadio && onlineMode) {
                onlineMode.checked = true;
                joinRadio.checked = true;
                createRadio.checked = false;
                
                // Mostrar/ocultar grupos apropiados
                const difficultyGroup = document.getElementById('difficulty-group');
                const onlineGroup = document.getElementById('online-group');
                const roomIdGroup = document.getElementById('room-id-group');
                const roomInfoGroup = document.getElementById('room-info-group');
                
                if (difficultyGroup) difficultyGroup.style.display = 'none';
                if (onlineGroup) onlineGroup.style.display = 'block';
                if (roomIdGroup) roomIdGroup.style.display = 'block';
                if (roomInfoGroup) roomInfoGroup.style.display = 'none';
                
                // Llenar el campo de ID de sala
                const roomIdInput = document.getElementById('room-id');
                if (roomIdInput) {
                    roomIdInput.value = roomId;
                }
            }
        }
    }

    // Configurar listeners del chat
    setupChatListeners() {
        // Botón para mostrar/ocultar chat
        this.addEventListener(
            document.getElementById('toggle-chat-btn'),
            'click',
            () => this.toggleChat(),
            'toggle-chat-btn'
        );

        // Botón para colapsar chat
        this.addEventListener(
            document.getElementById('toggle-chat'),
            'click',
            () => this.collapseChat(),
            'toggle-chat'
        );

        // Enviar mensaje
        this.addEventListener(
            document.getElementById('send-message'),
            'click',
            () => this.sendMessage(),
            'send-message'
        );

        // Enviar mensaje con Enter
        this.addEventListener(
            document.getElementById('chat-input'),
            'keypress',
            (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            },
            'chat-input-enter'
        );
    }

    // Mostrar chat
    showChat() {
        const chatContainer = document.getElementById('chat-container');
        const toggleChatBtn = document.getElementById('toggle-chat-btn');
        
        if (chatContainer) chatContainer.style.display = 'block';
        if (toggleChatBtn) toggleChatBtn.style.display = 'inline-block';
    }

    // Ocultar chat
    hideChat() {
        const chatContainer = document.getElementById('chat-container');
        const toggleChatBtn = document.getElementById('toggle-chat-btn');
        
        if (chatContainer) chatContainer.style.display = 'none';
        if (toggleChatBtn) toggleChatBtn.style.display = 'none';
    }

    // Alternar chat
    toggleChat() {
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.style.display = chatContainer.style.display === 'none' ? 'block' : 'none';
        }
    }

    // Colapsar chat
    collapseChat() {
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.classList.toggle('collapsed');
        }
    }

    // Inicializar chat
    initializeChat() {
        // Limpiar mensajes anteriores
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.innerHTML = '<div class="chat-message system"><span class="message-time">00:00</span><span class="message-text">¡Bienvenido al chat! Puedes comunicarte con tu oponente aquí.</span></div>';
        }
    }

    // Inicializar chat en línea con Firebase
    initializeOnlineChat(roomId) {
        if (!roomId) return;
        
        this.chatRef = window.db.collection('rooms').doc(roomId).collection('messages');
        
        // Cargar mensajes anteriores
        this.loadPreviousMessages(roomId);
        
        // Escuchar mensajes en tiempo real
        this.chatRef.orderBy('timestamp', 'asc').onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    const isOwnMessage = data.senderId === window.currentUser.uid;
                    
                    this.addChatMessage(
                        isOwnMessage ? 'own' : 'other', 
                        data.message, 
                        data.sender
                    );
                }
            });
        }, (error) => {
            console.error('Error al escuchar mensajes:', error);
        });
    }

    // Cargar mensajes anteriores
    loadPreviousMessages(roomId) {
        if (!roomId) return;
        
        this.chatRef.orderBy('timestamp', 'asc').limit(50).get().then((snapshot) => {
            snapshot.forEach((doc) => {
                const data = doc.data();
                const isOwnMessage = data.senderId === window.currentUser.uid;
                
                // Solo agregar si no es nuestro propio mensaje (para evitar duplicados)
                if (!isOwnMessage) {
                    this.addChatMessage('other', data.message, data.sender);
                }
            });
        }).catch(error => {
            console.error('Error al cargar mensajes anteriores:', error);
        });
    }

    // Mostrar información de la sala
    showRoomInfo(roomId, role) {
        const roomInfoEl = document.getElementById('room-info');
        if (roomInfoEl) {
            roomInfoEl.innerHTML = `
                <div class="room-info">
                    <h3>Información de la Sala</h3>
                    <p><strong>ID de Sala:</strong> ${roomId}</p>
                    <p><strong>Tu rol:</strong> ${role === 'host' ? 'Anfitrión (X)' : 'Invitado (O)'}</p>
                    <p><strong>Estado:</strong> ${this.playerRole === 'host' ? 'Esperando jugador...' : 'Conectado'}</p>
                </div>
            `;
        }
    }

    // Inicializar historial de juego
    initializeGameHistory(roomId) {
        if (!roomId) return;
        
        this.movesRef = window.db.collection('rooms').doc(roomId).collection('moves');
        this.gameHistoryRef = window.db.collection('rooms').doc(roomId).collection('gameHistory');
        
        // Solo el host crea el historial de juego
        if (this.isHost) {
            this.gameHistoryRef.add({
                gameId: roomId,
                startTime: firebase.firestore.FieldValue.serverTimestamp(),
                player1: window.currentUser.uid,
                player2: null, // Se actualizará cuando se una el segundo jugador
                status: 'playing',
                moves: []
            }).then(docRef => {
                this.currentGameHistoryId = docRef.id;
                console.log('✅ Historial de juego inicializado:', docRef.id);
            }).catch(error => {
                console.error('❌ Error al inicializar historial:', error);
            });
        } else {
            // El guest busca el historial existente
            this.findExistingGameHistory(roomId);
        }
    }

    // Buscar historial existente (para guests)
    findExistingGameHistory(roomId) {
        this.gameHistoryRef.where('gameId', '==', roomId)
            .where('status', '==', 'playing')
            .limit(1)
            .get()
            .then(snapshot => {
                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    this.currentGameHistoryId = doc.id;
                    
                    // Actualizar el historial con el segundo jugador
                    this.gameHistoryRef.doc(doc.id).update({
                        player2: window.currentUser.uid
                    });
                    
                    console.log('✅ Historial de juego encontrado:', doc.id);
                } else {
                    console.log('⚠️ No se encontró historial existente');
                }
            })
            .catch(error => {
                console.error('❌ Error al buscar historial:', error);
            });
    }

    // Guardar movimiento
    saveMove(cellIndex, player) {
        if (!this.movesRef) {
            console.log('⚠️ Movimiento no guardado: movesRef no disponible');
            return;
        }
        
        if (!this.currentGameHistoryId) {
            console.log('⚠️ Movimiento no guardado: historial no inicializado');
            // Intentar encontrar el historial si no está disponible
            if (!this.isHost) {
                this.findExistingGameHistory(this.currentRoomId);
            }
            return;
        }
        
        const moveData = {
            cellIndex: cellIndex,
            player: player,
            playerId: window.currentUser.uid,
            playerName: window.currentUser.displayName || 'Jugador',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            moveNumber: gameBoard.filter(cell => cell !== '').length + 1,
            gameHistoryId: this.currentGameHistoryId
        };
        
        this.movesRef.add(moveData).then(() => {
            console.log(`✅ Movimiento guardado: ${player} en celda ${cellIndex}`);
            
            // Agregar mensaje al chat sobre el movimiento
            this.addChatMessage('system', `${moveData.playerName} jugó ${player} en la posición ${cellIndex + 1}`);
        }).catch(error => {
            console.error('❌ Error al guardar movimiento:', error);
        });
    }

    // Guardar resultado del juego
    saveGameResult(winner, result) {
        if (!this.gameHistoryRef || !this.currentGameHistoryId) return;
        
        const gameResult = {
            winner: winner,
            result: result, // 'win', 'draw', 'lose'
            endTime: firebase.firestore.FieldValue.serverTimestamp(),
            finalBoard: [...gameBoard],
            totalMoves: gameBoard.filter(cell => cell !== '').length
        };
        
        this.gameHistoryRef.doc(this.currentGameHistoryId).update(gameResult).then(() => {
            console.log('✅ Resultado del juego guardado:', result);
            
            // Agregar mensaje al chat sobre el resultado
            let resultMessage = '';
            if (result === 'win') {
                resultMessage = `¡${winner} ha ganado la partida!`;
            } else if (result === 'draw') {
                resultMessage = '¡La partida terminó en empate!';
            }
            
            if (resultMessage) {
                this.addChatMessage('system', resultMessage);
            }
        }).catch(error => {
            console.error('❌ Error al guardar resultado:', error);
        });
    }

    // Limpiar juego en línea
    cleanupOnlineGame() {
        if (this.roomRef) {
            // Si somos el host y el juego no ha terminado, eliminar la sala
            if (this.isHost && gameActive) {
                this.roomRef.delete().catch(error => {
                    console.error('Error al eliminar sala:', error);
                });
            }
            
            // Limpiar listeners
            this.roomRef = null;
        }
        
        if (this.chatRef) {
            this.chatRef = null;
        }
        
        if (this.movesRef) {
            this.movesRef = null;
        }
        
        if (this.gameHistoryRef) {
            this.gameHistoryRef = null;
        }
        
        // Resetear variables
        this.currentRoomId = null;
        this.isHost = false;
        this.playerRole = null;
        this.playerJoinedNotified = false;
        this.currentGameHistoryId = null;
        
        console.log('✅ Juego en línea limpiado');
    }

    // Enviar mensaje
    sendMessage() {
        const chatInput = document.getElementById('chat-input');
        if (!chatInput) return;

        const message = chatInput.value.trim();
        if (!message) return;

        // Limpiar input
        chatInput.value = '';
        
        // Enviar mensaje a Firebase si estamos en modo en línea
        if (gameMode === 'online' && this.chatRef) {
            const playerName = window.currentUser?.displayName || 'Jugador';
            const messageData = {
                message: message,
                sender: playerName,
                senderId: window.currentUser.uid,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                roomId: this.currentRoomId,
                gameStatus: gameActive ? 'playing' : 'finished',
                moveNumber: gameBoard.filter(cell => cell !== '').length
            };
            
            this.chatRef.add(messageData).then(() => {
                console.log('✅ Mensaje guardado en Firebase');
            }).catch(error => {
                console.error('Error al enviar mensaje:', error);
                this.addChatMessage('system', 'Error al enviar mensaje');
            });
        } else {
            // Modo local - solo mostrar mensaje
            this.addChatMessage('own', message);
        }
    }

    // Agregar mensaje al chat
    addChatMessage(type, text, sender = null) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}`;
        
        const time = new Date().toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const senderText = sender ? `<span class="message-sender">${sender}:</span>` : '';
        
        messageDiv.innerHTML = `
            <span class="message-time">${time}</span>
            ${senderText}
            <span class="message-text">${text}</span>
        `;
        
        chatMessages.appendChild(messageDiv);
        
        // Scroll hacia abajo
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Crear nueva sala
    async createNewRoom() {
        try {
            const roomId = this.generateRandomRoomId();
            const roomRef = window.db.collection('rooms').doc(roomId);
            
            // Obtener datos del jugador 1 de Firestore
            const playerDoc = await window.db.collection('players').doc(window.currentUser.uid).get();
            const playerData = playerDoc.data();
            
            await roomRef.set({
                id: roomId,
                player1: window.currentUser.uid,
                player1Name: playerData.name || window.currentUser.displayName || 'Jugador 1',
                player1Data: {
                    uid: window.currentUser.uid,
                    name: playerData.name,
                    email: playerData.email,
                    gamesPlayed: playerData.gamesPlayed || 0,
                    gamesWon: playerData.gamesWon || 0,
                    created: firebase.firestore.FieldValue.serverTimestamp()
                },
                status: 'waiting',
                created: firebase.firestore.FieldValue.serverTimestamp(),
                board: ['', '', '', '', '', '', '', '', ''],
                turn: 'X',
                winner: null,
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });

            this.currentRoomId = roomId;
            this.isHost = true;
            this.playerRole = 'host';
            
            // Mostrar ID de la sala y enlace
            document.getElementById('display-room-id').textContent = roomId;
            document.getElementById('share-link').value = window.location.origin + window.location.pathname + '?room=' + roomId;
            
            // Mostrar mensaje de espera
            document.getElementById('waiting-message').style.display = 'block';
            document.getElementById('ready-message').style.display = 'none';
            
            // Iniciar escucha de cambios en la sala
            this.listenToRoomChanges(roomId);
            
            return roomId;
        } catch (error) {
            console.error('Error al crear sala:', error);
            alert('Error al crear la sala. Por favor, intenta de nuevo.');
        }
    }

    // Unirse a una sala existente
    async joinExistingRoom(roomId) {
        try {
            const roomRef = window.db.collection('rooms').doc(roomId);
            const roomDoc = await roomRef.get();
            
            if (!roomDoc.exists) {
                alert('La sala no existe');
                return;
            }
            
            const roomData = roomDoc.data();
            
            // Verificar si la sala expiró (más de 1 hora de inactividad)
            const lastActivity = roomData.lastActivity?.toDate() || roomData.created?.toDate();
            if (lastActivity && (Date.now() - lastActivity.getTime() > 3600000)) {
                alert('Esta sala ha expirado. Por favor crea una nueva.');
                return;
            }
            
            if (roomData.player2) {
                alert('La sala está llena');
                return;
            }
            
            // Verificar si el jugador ya está en la sala
            if (roomData.player1 === window.currentUser.uid) {
                alert('Ya estás en esta sala como Jugador 1');
                return;
            }

            // Obtener datos del jugador 2 de Firestore
            const playerDoc = await window.db.collection('players').doc(window.currentUser.uid).get();
            const playerData = playerDoc.data();
            
            // Unirse a la sala con información completa del jugador
            await roomRef.update({
                player2: window.currentUser.uid,
                player2Name: playerData.name || window.currentUser.displayName || 'Jugador 2',
                player2Data: {
                    uid: window.currentUser.uid,
                    name: playerData.name,
                    email: playerData.email,
                    gamesPlayed: playerData.gamesPlayed || 0,
                    gamesWon: playerData.gamesWon || 0,
                    lastJoined: firebase.firestore.FieldValue.serverTimestamp()
                },
                status: 'ready'
            });
            
            this.currentRoomId = roomId;
            this.isHost = false;
            this.playerRole = 'guest';
            
            // Iniciar escucha de cambios en la sala
            this.listenToRoomChanges(roomId);
            
            // Mostrar mensaje de listo
            document.getElementById('waiting-message').style.display = 'none';
            document.getElementById('ready-message').style.display = 'block';
            
            return true;
        } catch (error) {
            console.error('Error al unirse a la sala:', error);
            alert('Error al unirse a la sala. Por favor, intenta de nuevo.');
            return false;
        }
    }

    // Generar ID aleatorio para la sala
    generateRandomRoomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Escuchar cambios en la sala
    listenToRoomChanges(roomId) {
        if (this.roomRef) {
            this.roomRef();  // Desuscribir de la escucha anterior
        }
        
        this.roomRef = window.db.collection('rooms').doc(roomId)
            .onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    this.updateRoomState(data);
                }
            }, (error) => {
                console.error('Error al escuchar cambios en la sala:', error);
            });
    }

    // Actualizar estado de la sala
    updateRoomState(data) {
        if (!data) return;

        // Actualizar UI según el estado
        const waitingMessage = document.getElementById('waiting-message');
        const readyMessage = document.getElementById('ready-message');
        const startButton = document.getElementById('start-game-btn');
        
        // Actualizar información de los jugadores en la UI
        const player1Info = document.getElementById('player1-info');
        const player2Info = document.getElementById('player2-info');
        
        if (player1Info) {
            player1Info.textContent = `Jugador 1: ${data.player1Name}`;
        }
        
        if (player2Info) {
            player2Info.textContent = data.player2Name ? 
                `Jugador 2: ${data.player2Name}` : 
                'Esperando Jugador 2...';
        }
        
        if (data.status === 'waiting') {
            waitingMessage.style.display = 'block';
            readyMessage.style.display = 'none';
            startButton.disabled = true;
        } else if (data.status === 'ready') {
            waitingMessage.style.display = 'none';
            readyMessage.style.display = 'block';
            startButton.disabled = false;
            
            if (!this.playerJoinedNotified && data.player2) {
                this.addChatMessage('system', '¡Jugador 2 se ha unido! La partida puede comenzar.');
                this.playerJoinedNotified = true;
            }
        }

        // Actualizar el estado del juego si está en curso
        if (data.status === 'playing') {
            this.updateGameState(data);
        }
    }
}

// Función global para mostrar pantallas (para compatibilidad)
window.showScreen = function(screenId) {
    if (window.gameManager) {
        window.gameManager.showScreen(screenId);
    }
};

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Inicializando aplicación...');
    try {
        window.gameManager = new GameManager();
        console.log('✅ Aplicación inicializada correctamente');
    } catch (error) {
        console.error('❌ Error al inicializar la aplicación:', error);
        alert('Error al iniciar la aplicación. Revisa la consola para más detalles.');
    }
});