# Filen Desktop Client for Windows, macOS and Linux
> Crossplatform desktop client written in JavaScript, making use of modern web technologies like Electron and ```crypto.subtle```

# Installation

Use node 14.17.1

``` bash
nvm install 14.17.1
nvm use 14.17.1
```

Use npm

``` bash
npm install
```

#### Build Setup

``` bash
# install dependencies
npm install

# run client
npm run start

# build electron application for production, where {arch} = win, mac or linux
npm run build-{arch}

```