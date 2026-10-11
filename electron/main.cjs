"use strict";

const { app, BrowserWindow, dialog, session, shell } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { allowsJarwisAudioPermission } = require("../lib/security/mediaPermission");

let server = null;
let mainWindow = null;

function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            probe.close(error => {
                if (error) reject(error);
                else resolve(address.port);
            });
        });
    });
}

function waitForServer(serverInstance) {
    return new Promise((resolve, reject) => {
        serverInstance.once("listening", resolve);
        serverInstance.once("error", reject);
    });
}

async function createWindow() {
    const userData = app.getPath("userData");
    const dataDirectory = path.join(userData, "data");
    const workspaceDirectory = path.join(userData, "workspace");
    const workspacesDirectory = path.join(userData, "workspaces");
    const envFile = path.join(userData, ".env");

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    fs.mkdirSync(workspacesDirectory, { recursive: true });
    if (!fs.existsSync(envFile)) {
        fs.copyFileSync(path.join(app.getAppPath(), ".env.example"), envFile);
    }

    process.env.NEXUS_ENV_FILE = envFile;
    process.env.NEXUS_DATA_DIR = dataDirectory;
    process.env.NEXUS_DB_FILE = path.join(dataDirectory, "nexus.db");
    process.env.NEXUS_WORKSPACE = workspaceDirectory;
    process.env.NEXUS_WORKSPACES_DIR = workspacesDirectory;
    process.env.NEXUS_HOST = "127.0.0.1";
    process.env.NEXUS_PORT = String(await findAvailablePort());

    const { startServer } = require("../src/server.js");
    server = startServer();
    await waitForServer(server);

    const address = server.address();
    const appUrl = `http://127.0.0.1:${address.port}`;
    const appOrigin = new URL(appUrl).origin;
    session.defaultSession.setPermissionRequestHandler(
        (_webContents, permission, callback, details = {}) => {
            callback(
                allowsJarwisAudioPermission(
                    permission,
                    details.requestingUrl,
                    appOrigin,
                    details.mediaTypes
                )
            );
        }
    );
    session.defaultSession.setPermissionCheckHandler(
        (_webContents, permission, requestingOrigin, details = {}) =>
            allowsJarwisAudioPermission(
                permission,
                requestingOrigin,
                appOrigin,
                details.mediaType
            )
    );
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 900,
        minHeight: 640,
        title: "Jarwis",
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const parsed = new URL(url);
            if (parsed.protocol === "https:" || parsed.protocol === "http:") {
                shell.openExternal(url);
            }
        } catch (error) {
            console.error("Blocked invalid external URL:", error.message);
        }
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== new URL(appUrl).origin) {
            event.preventDefault();
        }
    });

    await mainWindow.loadURL(appUrl);
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => createWindow()).catch(error => {
        console.error("Jarwis desktop startup failed:", error);
        dialog.showErrorBox("Jarwis could not start", error.message);
        app.quit();
    });
}

app.on("before-quit", () => {
    if (server?.listening) server.close();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
