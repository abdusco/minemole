<p align="center">
  <img src="icons/icon.svg" width="72" alt="MineMole icon">
</p>

# MineMole

A small, offline-ready Minesweeper game built with plain HTML, CSS, and JavaScript.

## Run locally

Serve this directory with any static web server, then open the app in a browser:

```sh
python3 -m http.server 8000
```

## Notes

- Choose from Easy, Medium, Hard, and Extreme boards.
- Game progress and theme preference are stored locally in the browser.
- `main.js` is the service worker and caches the app shell for offline play.
