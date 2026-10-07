# Raflido Online Racing — Backend Starter

Architecture:
- GitHub = source code
- Render = Node.js/WebSocket multiplayer server
- Firebase Authentication = Google login
- Firestore = coins, XP, race/player data
- Unity = final 3D racing client

## Folder structure

```text
raflido-racing/
├─ server/
│  ├─ src/
│  │  └─ index.js
│  ├─ package.json
│  ├─ .env.example
│  └─ .gitignore
├─ firebase/
│  ├─ firestore.rules
│  └─ firestore.indexes.json
├─ client-test/
│  └─ index.html
└─ render.yaml
```

## 1. Firebase

Create a Firebase project.

Enable:
- Authentication → Google
- Firestore Database

Create a Web App and copy its Firebase config into `client-test/index.html`.

For the server, create a Firebase Admin service account. Put its values into Render environment variables. NEVER upload the private key to GitHub.

## 2. Local server

Install Node.js 20+.

```bash
cd server
npm install
npm start
```

Server:
`http://localhost:10000`

WebSocket:
`ws://localhost:10000`

## 3. GitHub

Create a new repository, for example:

`raflido-online-racing`

Upload/push this entire project.

Do NOT upload:
- `.env`
- Firebase service-account JSON
- passwords
- private keys

## 4. Render

Create a Web Service from the GitHub repository.

Root Directory:
`server`

Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

Add environment variables from `server/.env.example`.

## 5. Important

The included browser client is only a network/login test. It is NOT the final 3D racing game.

The final Unity client should:
1. Google-login with Firebase
2. get Firebase ID token
3. connect to the WebSocket server
4. join matchmaking
5. send car input
6. receive race state
7. show 1st/2nd/3rd
8. receive coins/XP
9. save upgrades through the server

Never trust the Unity client to award itself coins. The server must decide rewards.
