(function (global) {
    "use strict";

    var NEIGHBOR_OFFSETS = [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
    ];

    function createMatrix(rows, cols, initialValue) {
        var matrix = new Array(rows);
        for (var r = 0; r < rows; r += 1) {
            matrix[r] = new Array(cols);
            for (var c = 0; c < cols; c += 1) {
                matrix[r][c] = typeof initialValue === "function" ? initialValue(r, c) : initialValue;
            }
        }
        return matrix;
    }

    function cloneMatrix(matrix) {
        return matrix.map(function (row) {
            return row.slice();
        });
    }

    function MinesweeperEngine(params) {
        if (!params || typeof params !== "object") {
            throw new Error("MinesweeperEngine requires a configuration object");
        }

        var rows = params.rows;
        var cols = params.cols;
        var mines = params.mines;

        if (!Number.isInteger(rows) || rows <= 0) {
            throw new Error("rows must be a positive integer");
        }
        if (!Number.isInteger(cols) || cols <= 0) {
            throw new Error("cols must be a positive integer");
        }
        if (!Number.isInteger(mines) || mines <= 0 || mines >= rows * cols) {
            throw new Error("mines must be a positive integer less than total cells");
        }

        this.rows = rows;
        this.cols = cols;
        this.mines = mines;
        this.random = typeof params.random === "function" ? params.random : Math.random;

        this.board = createMatrix(rows, cols, function () {
            return { hasMine: false, adjacent: 0 };
        });
        this.revealed = createMatrix(rows, cols, false);
        this.flagged = createMatrix(rows, cols, false);

        this.status = "pending";
        this.initialized = false;
        this.remainingFlags = mines;
        this.revealedSafeCells = 0;
        this.startedAt = null;
        this.elapsedMs = 0;
    }

    MinesweeperEngine.prototype._inBounds = function (row, col) {
        return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
    };

    MinesweeperEngine.prototype._neighbors = function (row, col) {
        var neighbors = [];
        for (var i = 0; i < NEIGHBOR_OFFSETS.length; i += 1) {
            var offset = NEIGHBOR_OFFSETS[i];
            var nr = row + offset[0];
            var nc = col + offset[1];
            if (this._inBounds(nr, nc)) {
                neighbors.push([nr, nc]);
            }
        }
        return neighbors;
    };

    MinesweeperEngine.prototype._placeMines = function (safeRow, safeCol) {
        var safeZone = {};
        safeZone[safeRow + "," + safeCol] = true;
        var surrounding = this._neighbors(safeRow, safeCol);
        for (var i = 0; i < surrounding.length; i += 1) {
            var coord = surrounding[i];
            safeZone[coord[0] + "," + coord[1]] = true;
        }

        var placed = 0;
        while (placed < this.mines) {
            var candidateRow = Math.floor(this.random() * this.rows);
            var candidateCol = Math.floor(this.random() * this.cols);
            var key = candidateRow + "," + candidateCol;
            if (safeZone[key]) {
                continue;
            }
            var cell = this.board[candidateRow][candidateCol];
            if (!cell.hasMine) {
                cell.hasMine = true;
                placed += 1;
            }
        }
    };

    MinesweeperEngine.prototype._computeAdjacents = function () {
        for (var row = 0; row < this.rows; row += 1) {
            for (var col = 0; col < this.cols; col += 1) {
                var cell = this.board[row][col];
                if (cell.hasMine) {
                    continue;
                }
                var neighbors = this._neighbors(row, col);
                var count = 0;
                for (var i = 0; i < neighbors.length; i += 1) {
                    var neighborCoord = neighbors[i];
                    if (this.board[neighborCoord[0]][neighborCoord[1]].hasMine) {
                        count += 1;
                    }
                }
                cell.adjacent = count;
            }
        }
    };

    MinesweeperEngine.prototype._ensureInitialized = function (row, col) {
        if (this.initialized) {
            return;
        }
        this._placeMines(row, col);
        this._computeAdjacents();
        this.initialized = true;
        this._markStarted();
    };

    MinesweeperEngine.prototype._markStarted = function () {
        if (this.startedAt === null) {
            this.startedAt = Date.now();
        }
    };

    MinesweeperEngine.prototype._finalizeElapsed = function () {
        this.elapsedMs = this.getElapsedMs();
        this.startedAt = null;
    };

    MinesweeperEngine.prototype.getElapsedMs = function (now) {
        var reference = typeof now === "number" ? now : Date.now();
        if (this.startedAt !== null && this.status === "pending") {
            return this.elapsedMs + (reference - this.startedAt);
        }
        return this.elapsedMs;
    };

    MinesweeperEngine.prototype.reveal = function (row, col) {
        if (!this._inBounds(row, col)) {
            return { status: this.status, changed: [] };
        }
        if (this.status !== "pending") {
            return { status: this.status, changed: [] };
        }
        if (this.flagged[row][col]) {
            return { status: this.status, changed: [] };
        }

        this._ensureInitialized(row, col);

        if (this.revealed[row][col]) {
            return { status: this.status, changed: [] };
        }

        var target = this.board[row][col];
        var changed = [];

        if (target.hasMine) {
            this.revealed[row][col] = true;
            changed.push({ row: row, col: col });
            this.status = "lost";
            this._finalizeElapsed();
            return { status: this.status, changed: changed, mineTriggered: true };
        }

        var queue = [[row, col]];
        while (queue.length > 0) {
            var current = queue.shift();
            var r = current[0];
            var c = current[1];
            if (this.revealed[r][c]) {
                continue;
            }
            this.revealed[r][c] = true;
            this.revealedSafeCells += 1;
            changed.push({ row: r, col: c });

            var cell = this.board[r][c];
            if (cell.adjacent === 0) {
                var neighbors = this._neighbors(r, c);
                for (var i = 0; i < neighbors.length; i += 1) {
                    var neighbor = neighbors[i];
                    var nr = neighbor[0];
                    var nc = neighbor[1];
                    if (!this.revealed[nr][nc] && !this.flagged[nr][nc]) {
                        queue.push([nr, nc]);
                    }
                }
            }
        }

        if (this.revealedSafeCells === this.rows * this.cols - this.mines) {
            this.status = "won";
            this._finalizeElapsed();
        }

        return { status: this.status, changed: changed, mineTriggered: false };
    };

    MinesweeperEngine.prototype.toggleFlag = function (row, col) {
        if (!this._inBounds(row, col)) {
            return { status: this.status, flagged: false };
        }
        if (this.status !== "pending") {
            return { status: this.status, flagged: this.flagged[row][col] };
        }
        if (this.revealed[row][col]) {
            return { status: this.status, flagged: this.flagged[row][col] };
        }

        var next = !this.flagged[row][col];
        if (next && this.remainingFlags <= 0) {
            return { status: this.status, flagged: this.flagged[row][col] };
        }

        this.flagged[row][col] = next;
        this.remainingFlags += next ? -1 : 1;
        this._markStarted();
        return { status: this.status, flagged: next };
    };

    MinesweeperEngine.prototype.chord = function (row, col) {
        if (!this._inBounds(row, col)) {
            return { status: this.status, changed: [] };
        }
        if (this.status !== "pending") {
            return { status: this.status, changed: [] };
        }
        if (!this.revealed[row][col]) {
            return { status: this.status, changed: [] };
        }

        var cell = this.board[row][col];
        if (cell.adjacent <= 0) {
            return { status: this.status, changed: [] };
        }

        var neighbors = this._neighbors(row, col);
        var flaggedCount = 0;
        var candidates = [];

        for (var i = 0; i < neighbors.length; i += 1) {
            var coord = neighbors[i];
            var nr = coord[0];
            var nc = coord[1];
            if (this.flagged[nr][nc]) {
                flaggedCount += 1;
            } else if (!this.revealed[nr][nc]) {
                candidates.push(coord);
            }
        }

        if (flaggedCount !== cell.adjacent) {
            return { status: this.status, changed: [] };
        }

        var aggregate = [];
        var mineTriggered = false;

        for (var j = 0; j < candidates.length; j += 1) {
            var candidate = candidates[j];
            var outcome = this.reveal(candidate[0], candidate[1]);
            if (outcome.mineTriggered) {
                mineTriggered = true;
            }
            if (outcome.changed && outcome.changed.length > 0) {
                aggregate = aggregate.concat(outcome.changed);
            }
            if (this.status !== "pending") {
                break;
            }
        }

        return { status: this.status, changed: aggregate, mineTriggered: mineTriggered };
    };

    MinesweeperEngine.prototype.revealAllMines = function () {
        var changed = [];
        for (var row = 0; row < this.rows; row += 1) {
            for (var col = 0; col < this.cols; col += 1) {
                var cell = this.board[row][col];
                if (cell.hasMine && !this.revealed[row][col]) {
                    this.revealed[row][col] = true;
                    changed.push({ row: row, col: col });
                }
            }
        }
        return changed;
    };

    MinesweeperEngine.prototype.cellView = function (row, col) {
        if (!this._inBounds(row, col)) {
            return null;
        }
        var cell = this.board[row][col];
        return {
            hasMine: cell.hasMine,
            adjacent: cell.adjacent,
            revealed: this.revealed[row][col],
            flagged: this.flagged[row][col],
        };
    };

    MinesweeperEngine.prototype.snapshot = function (now) {
        var reference = typeof now === "number" ? now : Date.now();
        return {
            rows: this.rows,
            cols: this.cols,
            mines: this.mines,
            board: this.board.map(function (row) {
                return row.map(function (cell) {
                    return { hasMine: cell.hasMine, adjacent: cell.adjacent };
                });
            }),
            revealed: cloneMatrix(this.revealed),
            flagged: cloneMatrix(this.flagged),
            status: this.status,
            initialized: this.initialized,
            remainingFlags: this.remainingFlags,
            revealedSafeCells: this.revealedSafeCells,
            elapsedMs: this.getElapsedMs(reference),
            timerRunning: this.startedAt !== null && this.status === "pending",
        };
    };

    MinesweeperEngine.fromSnapshot = function (snapshot) {
        if (!snapshot) {
            return null;
        }
        var engine = new MinesweeperEngine({
            rows: snapshot.rows,
            cols: snapshot.cols,
            mines: snapshot.mines,
        });
        engine.board = snapshot.board.map(function (row) {
            return row.map(function (cell) {
                return { hasMine: !!cell.hasMine, adjacent: Number(cell.adjacent) || 0 };
            });
        });
        engine.revealed = cloneMatrix(snapshot.revealed || createMatrix(snapshot.rows, snapshot.cols, false));
        engine.flagged = cloneMatrix(snapshot.flagged || createMatrix(snapshot.rows, snapshot.cols, false));
        engine.status = snapshot.status || "pending";
        engine.initialized = Boolean(snapshot.initialized);
        engine.remainingFlags = Number.isFinite(snapshot.remainingFlags) ? snapshot.remainingFlags : snapshot.mines;
        engine.revealedSafeCells = Number(snapshot.revealedSafeCells) || 0;
        engine.elapsedMs = Number(snapshot.elapsedMs) || 0;
        if (snapshot.timerRunning && engine.status === "pending") {
            engine.startedAt = Date.now();
        }
        return engine;
    };

    global.MinesweeperEngine = MinesweeperEngine;
})(window);
