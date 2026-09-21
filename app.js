(function () {
    "use strict";

    var STORAGE_KEY = "minemole:game-state";
    var THEME_KEY = "minemole:theme";
    var FLAG_ICON = '<svg class="cell__flag-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-flag"></use></svg>';
    var EXPLOSION_ICON = '<svg class="cell__explosion-icon" viewBox="0 0 2048 2048" aria-hidden="true"><use href="#icon-explosion"></use></svg>';
    var DIFFICULTIES = {
        easy: { rows: 9, cols: 9, mines: 10 },
        medium: { rows: 16, cols: 16, mines: 40 },
        hard: { rows: 16, cols: 30, mines: 99 },
        extreme: { rows: 24, cols: 30, mines: 180 },
    };

    var elements = {
        board: document.querySelector("[data-board]"),
        difficulty: document.querySelector("[data-difficulty]"),
        newGame: document.querySelector("[data-new-game]"),
        flagMode: document.querySelector("[data-flag-mode]"),
        themeToggle: document.querySelector("[data-theme-toggle]"),
        timer: document.querySelector("[data-timer]"),
        mines: document.querySelector("[data-mines]"),
        message: document.querySelector("[data-message]"),
        modal: document.querySelector("[data-modal]"),
        modalBackdrop: document.querySelector("[data-modal-backdrop]"),
        modalTitle: document.querySelector("[data-modal-title]"),
        modalMessage: document.querySelector("[data-modal-message]"),
        modalNewGame: document.querySelector("[data-modal-new-game]"),
        modalRewind: document.querySelector("[data-modal-rewind]"),
    };

    var mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    var engine = null;
    var currentDifficulty = "easy";
    var flagModeEnabled = false;
    var timerInterval = null;
    var timerAnchor = null;
    var baseElapsedMs = 0;
    var previousGameState = null;

    function init() {
        bindEvents();
        applyTheme(loadThemePreference());
        restoreSavedGame();
        registerServiceWorker();
    }

    function bindEvents() {
        if (elements.difficulty) {
            elements.difficulty.addEventListener("change", function (event) {
                var difficulty = event.target.value;
                if (!DIFFICULTIES[difficulty]) {
                    return;
                }
                startNewGame(difficulty);
            });
        }

        if (elements.newGame) {
            elements.newGame.addEventListener("click", function () {
                startNewGame(currentDifficulty);
            });
        }

        if (elements.flagMode) {
            elements.flagMode.addEventListener("click", function () {
                flagModeEnabled = !flagModeEnabled;
                updateFlagModeButton();
                saveState();
            });
        }

        if (elements.themeToggle) {
            elements.themeToggle.addEventListener("click", function () {
                cycleThemePreference();
            });
        }

        var mediaListener = function () {
            if (document.body.getAttribute("data-theme") === "auto") {
                reflectSystemTheme();
            }
        };

        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", mediaListener);
        } else if (typeof mediaQuery.addListener === "function") {
            mediaQuery.addListener(mediaListener);
        }

        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden") {
                saveState();
            }
        });

        window.addEventListener("beforeunload", function () {
            saveState();
        });

        if (elements.modalBackdrop) {
            elements.modalBackdrop.addEventListener("click", function () {
                hideModal();
            });
        }

        if (elements.modalNewGame) {
            elements.modalNewGame.addEventListener("click", function () {
                hideModal();
                startNewGame(currentDifficulty);
            });
        }

        if (elements.modalRewind) {
            elements.modalRewind.addEventListener("click", function () {
                hideModal();
                rewindLastMove();
            });
        }
    }

    function buildBoard() {
        if (!engine || !elements.board) {
            return;
        }

        elements.board.innerHTML = "";
        elements.board.style.setProperty("--cols", String(engine.cols));
        elements.board.dataset.cols = String(engine.cols);
        elements.board.setAttribute("aria-rowcount", String(engine.rows));
        elements.board.setAttribute("aria-colcount", String(engine.cols));

        for (var row = 0; row < engine.rows; row += 1) {
            for (var col = 0; col < engine.cols; col += 1) {
                var cell = document.createElement("button");
                cell.className = "cell";
                cell.type = "button";
                cell.dataset.row = String(row);
                cell.dataset.col = String(col);
                cell.setAttribute("aria-label", "Hidden cell");
                cell.addEventListener("click", onCellClick);
                cell.addEventListener("contextmenu", onCellContextMenu);
                elements.board.appendChild(cell);
            }
        }
    }

    function onCellClick(event) {
        var target = event.currentTarget;
        var row = Number(target.dataset.row);
        var col = Number(target.dataset.col);

        if (!engine) {
            return;
        }

        var view = engine.cellView(row, col);

        if (flagModeEnabled && (!view || !view.revealed)) {
            handleFlag(row, col);
            return;
        }

        if (view && view.revealed) {
            handleChord(row, col);
            return;
        }

        handleReveal(row, col);
    }

    function onCellContextMenu(event) {
        event.preventDefault();
        var target = event.currentTarget;
        var row = Number(target.dataset.row);
        var col = Number(target.dataset.col);
        handleFlag(row, col);
    }

    function handleReveal(row, col) {
        if (!engine || engine.status !== "pending") {
            return;
        }

        // Save state before revealing (for rewind)
        saveGameStateForRewind();

        var result = engine.reveal(row, col);
        if (result.changed.length === 0 && !result.mineTriggered) {
            return;
        }

        ensureTimerRunning();

        if (result.mineTriggered) {
            engine.revealAllMines();
            stopTimer();
            setMessage("Boom! Game over.");
            showModal("Game Over!", "You hit a mine!");
        } else if (result.status === "won") {
            stopTimer();
            setMessage("You cleared the field!");
            showModal("Congratulations!", "You cleared the field! 🎉");
        } else {
            setMessage("Keep going!");
        }

        if (engine.status === "won" || engine.status === "lost") {
            stopTimer();
        }

        updateBoardView();
        updateStatusBar();
        saveState();
    }

    function handleChord(row, col) {
        if (!engine || engine.status !== "pending") {
            return;
        }

        // Save state before chording (for rewind)
        saveGameStateForRewind();

        var result = engine.chord(row, col);
        if (!result || (result.changed.length === 0 && !result.mineTriggered)) {
            return;
        }

        ensureTimerRunning();

        if (result.mineTriggered) {
            engine.revealAllMines();
            stopTimer();
            setMessage("Boom! Game over.");
            showModal("Game Over!", "You hit a mine!");
        } else if (engine.status === "won") {
            stopTimer();
            setMessage("You cleared the field!");
            showModal("Congratulations!", "You cleared the field! 🎉");
        } else {
            setMessage("Keep going!");
        }

        if (engine.status === "won" || engine.status === "lost") {
            stopTimer();
        }

        updateBoardView();
        updateStatusBar();
        saveState();
    }

    function handleFlag(row, col) {
        if (!engine || engine.status !== "pending") {
            return;
        }

        var before = engine.cellView(row, col).flagged;
        var outcome = engine.toggleFlag(row, col);

        if (before === outcome.flagged && !before && engine.remainingFlags === 0) {
            setMessage("No flags available.");
            return;
        }

        if (outcome.flagged !== before) {
            ensureTimerRunning();
            setMessage(outcome.flagged ? "Flag placed." : "Flag removed.");
            updateBoardView();
            updateStatusBar();
            saveState();
        }
    }

    function updateBoardView() {
        if (!elements.board || !engine) {
            return;
        }

        var children = elements.board.children;
        for (var i = 0; i < children.length; i += 1) {
            var cellEl = children[i];
            var row = Number(cellEl.dataset.row);
            var col = Number(cellEl.dataset.col);
            var view = engine.cellView(row, col);
            if (!view) {
                continue;
            }

            cellEl.classList.remove("cell--revealed", "cell--mine", "cell--flagged");
            cellEl.textContent = "";

            if (view.revealed) {
                cellEl.classList.add("cell--revealed");
                if (view.hasMine) {
                    cellEl.classList.add("cell--mine");
                    cellEl.innerHTML = EXPLOSION_ICON;
                    cellEl.setAttribute("aria-label", "Mine");
                } else if (view.adjacent > 0) {
                    cellEl.textContent = String(view.adjacent);
                    cellEl.setAttribute("aria-label", view.adjacent + " nearby mines");
                } else {
                    cellEl.setAttribute("aria-label", "Empty");
                }
            } else if (view.flagged) {
                cellEl.classList.add("cell--flagged");
                cellEl.innerHTML = FLAG_ICON;
                cellEl.setAttribute("aria-label", "Flagged cell");
            } else {
                cellEl.setAttribute("aria-label", "Hidden cell");
            }
        }
    }

    function updateStatusBar() {
        if (!engine) {
            return;
        }
        if (elements.mines) {
            elements.mines.textContent = "Flags: " + formatCounter(engine.remainingFlags);
        }
        updateTimerDisplay();
        if (elements.message) {
            if (engine.status === "won") {
                elements.message.textContent = "You cleared the field!";
            } else if (engine.status === "lost") {
                elements.message.textContent = "Boom! Game over.";
            }
        }
    }

    function setMessage(text) {
        if (elements.message) {
            elements.message.textContent = text;
        }
    }

    function ensureTimerRunning() {
        if (timerInterval || !engine || engine.status !== "pending") {
            return;
        }
        timerAnchor = Date.now();
        timerInterval = window.setInterval(updateTimerDisplay, 1000);
        updateTimerDisplay();
    }

    function stopTimer() {
        if (timerInterval) {
            window.clearInterval(timerInterval);
            timerInterval = null;
        }
        baseElapsedMs = getElapsedMs();
        timerAnchor = null;
        updateTimerDisplay();
    }

    function resetTimer() {
        if (timerInterval) {
            window.clearInterval(timerInterval);
            timerInterval = null;
        }
        baseElapsedMs = 0;
        timerAnchor = null;
        updateTimerDisplay();
    }

    function getElapsedMs() {
        if (timerAnchor === null) {
            return baseElapsedMs;
        }
        return baseElapsedMs + (Date.now() - timerAnchor);
    }

    function updateTimerDisplay() {
        if (!elements.timer) {
            return;
        }
        var elapsed = getElapsedMs();
        var seconds = Math.floor(elapsed / 1000);
        elements.timer.textContent = "Time: " + formatCounter(seconds);
    }

    function formatCounter(value) {
        var normalized = Math.max(0, Number(value) || 0);
        if (normalized > 9999) {
            normalized = 9999;
        }
        return String(normalized).padStart(3, "0");
    }

    function startNewGame(difficultyKey) {
        var config = DIFFICULTIES[difficultyKey] || DIFFICULTIES.easy;
        currentDifficulty = difficultyKey;
        engine = new MinesweeperEngine(config);

        if (elements.difficulty) {
            elements.difficulty.value = difficultyKey;
        }

        flagModeEnabled = false;
        previousGameState = null;
        updateFlagModeButton();
        resetTimer();
        setMessage("Ready?");

        buildBoard();
        updateBoardView();
        updateStatusBar();
        saveState();
    }

    function restoreSavedGame() {
        var storedRaw = null;
        try {
            storedRaw = localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            storedRaw = null;
        }

        if (!storedRaw) {
            startNewGame("easy");
            return;
        }

        var data;
        try {
            data = JSON.parse(storedRaw);
        } catch (error) {
            startNewGame("easy");
            return;
        }

        if (!data || typeof data !== "object" || !data.engine) {
            startNewGame("easy");
            return;
        }

        var difficultyKey = data.difficulty && DIFFICULTIES[data.difficulty] ? data.difficulty : "easy";
        currentDifficulty = difficultyKey;

        engine = MinesweeperEngine.fromSnapshot(data.engine);
        if (!engine) {
            startNewGame(difficultyKey);
            return;
        }

        flagModeEnabled = Boolean(data.flagMode);
        if (elements.difficulty) {
            elements.difficulty.value = difficultyKey;
        }

        baseElapsedMs = Number(data.elapsedMs) || data.engine.elapsedMs || 0;
        if (data.engine.timerRunning && engine.status === "pending") {
            timerAnchor = Date.now();
            timerInterval = window.setInterval(updateTimerDisplay, 1000);
        } else {
            timerAnchor = null;
            if (timerInterval) {
                window.clearInterval(timerInterval);
                timerInterval = null;
            }
        }

        buildBoard();
        updateBoardView();
        updateStatusBar();
        updateFlagModeButton();

        if (engine.status === "lost") {
            engine.revealAllMines();
            updateBoardView();
            stopTimer();
            setMessage("Boom! Game over.");
        } else if (engine.status === "won") {
            stopTimer();
            setMessage("You cleared the field!");
        } else {
            setMessage("Game restored. Good luck!");
        }
    }

    function updateFlagModeButton() {
        if (!elements.flagMode) {
            return;
        }
        elements.flagMode.textContent = "Flag Mode: " + (flagModeEnabled ? "On" : "Off");
        elements.flagMode.classList.toggle("is-secondary", !flagModeEnabled);
    }

    function applyTheme(theme) {
        var normalized = theme;
        if (!normalized || ["light", "dark", "auto"].indexOf(normalized) === -1) {
            normalized = "auto";
        }
        document.body.setAttribute("data-theme", normalized);
        if (elements.themeToggle) {
            elements.themeToggle.textContent = "Theme: " + capitalize(normalized);
        }
        reflectSystemTheme();
        persistThemePreference(normalized);
    }

    function reflectSystemTheme() {
        if (document.body.getAttribute("data-theme") === "auto") {
            if (mediaQuery.matches) {
                document.body.classList.add("prefers-dark");
            } else {
                document.body.classList.remove("prefers-dark");
            }
        } else {
            document.body.classList.remove("prefers-dark");
        }
    }

    function cycleThemePreference() {
        var current = document.body.getAttribute("data-theme") || "auto";
        var order = ["auto", "light", "dark"];
        var index = order.indexOf(current);
        var next = order[(index + 1) % order.length];
        applyTheme(next);
    }

    function loadThemePreference() {
        try {
            var stored = localStorage.getItem(THEME_KEY);
            if (stored && ["light", "dark", "auto"].indexOf(stored) !== -1) {
                return stored;
            }
        } catch (error) {
            return "auto";
        }
        return "auto";
    }

    function persistThemePreference(theme) {
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (error) {
            // Ignored: storage may be unavailable.
        }
    }

    function capitalize(value) {
        if (!value) {
            return "";
        }
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    function saveState() {
        if (!engine) {
            return;
        }
        var snapshot = engine.snapshot(Date.now());
        var payload = {
            version: 1,
            difficulty: currentDifficulty,
            engine: snapshot,
            elapsedMs: getElapsedMs(),
            flagMode: flagModeEnabled,
            savedAt: Date.now(),
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            // Storage may be unavailable; fail silently to avoid interrupting play.
        }
    }

    function showModal(title, message) {
        if (!elements.modal) {
            return;
        }
        if (elements.modalTitle) {
            elements.modalTitle.textContent = title;
        }
        if (elements.modalMessage) {
            elements.modalMessage.textContent = message;
        }

        // Hide rewind button for win condition
        if (elements.modalRewind) {
            if (engine && engine.status === "won") {
                elements.modalRewind.style.display = "none";
            } else {
                elements.modalRewind.style.display = "";
            }
        }

        // Use setTimeout to ensure the modal appears after DOM updates
        setTimeout(function () {
            elements.modal.removeAttribute("hidden");
        }, 100);
    }

    function hideModal() {
        if (!elements.modal) {
            return;
        }
        elements.modal.setAttribute("hidden", "");
    }

    function saveGameStateForRewind() {
        if (!engine) {
            return;
        }
        previousGameState = {
            snapshot: engine.snapshot(Date.now()),
            elapsedMs: getElapsedMs(),
        };
    }

    function rewindLastMove() {
        if (!previousGameState || !previousGameState.snapshot) {
            setMessage("No move to rewind.");
            return;
        }

        engine = MinesweeperEngine.fromSnapshot(previousGameState.snapshot);
        if (!engine) {
            setMessage("Failed to rewind.");
            return;
        }

        baseElapsedMs = Number(previousGameState.elapsedMs) || 0;
        if (previousGameState.snapshot.timerRunning && engine.status === "pending") {
            timerAnchor = Date.now();
            if (!timerInterval) {
                timerInterval = window.setInterval(updateTimerDisplay, 1000);
            }
        } else {
            timerAnchor = null;
        }

        buildBoard();
        updateBoardView();
        updateStatusBar();
        setMessage("Move rewound!");
        previousGameState = null;
        saveState();
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) {
            return;
        }
        window.addEventListener("load", function () {
            navigator.serviceWorker.register("service-worker.js").catch(function () {
                // Registration failed; ignoring to keep the game running.
            });
        });
    }

    init();
})();
