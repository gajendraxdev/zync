# Zync

**A Modern, Native SSH Client for the Future.**

Zync is a powerful, cross-platform SSH client built for speed and aesthetics. Rebuilt from the ground up using **Rust** and **Tauri**, it offers a native experience with minimal resource usage and maximum performance.

🌐 **Website:** [zync.thesudoer.in](https://zync.thesudoer.in)

## 🚀 Key Features

*   **Native Performance**: Blazing fast startup and low memory footprint.
*   **Advanced Tunneling**: Manage local and remote SSH tunnels with an intuitive, visual interface.
*   **Robust File Manager**: Full SFTP support including drag-and-drop, CRUD operations, and remote file handling.
*   **Productivity First**: System-level keyboard shortcuts and a command palette for rapid navigation.
*   **Auto-Updates**: Seamless background updates to keep you on the latest version.
*   **Cross-Platform**: Available on **Linux** (.deb, .rpm, .AppImage), **Windows** (.exe), and **macOS** (.dmg).
*   **Beautiful UI**: Premium aesthetics with multiple themes (Dark, Light, Dracula) that persist across restarts.

## 📥 Download

Get the latest release for your platform from our [Releases Page](https://github.com/FDgajju/zync/releases).

## 🛠️ Built With

*   [Tauri](https://tauri.app/) - Build smaller, faster, and more secure desktop applications with a web frontend.
*   [Rust](https://www.rust-lang.org/) - For the secure and performant backend.
*   [React](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/) - For the dynamic and responsive frontend.
*   [Vite](https://vitejs.dev/) - Next generation frontend tooling.

## 🏗️ Development

### Prerequisites

*   [Node.js](https://nodejs.org/) (LTS)
*   [Rust](https://www.rust-lang.org/tools/install) (latest stable)
*   **Linux Dependencies** (Ubuntu/Debian):
    ```bash
    sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
    ```

### Build from Source

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/FDgajju/zync.git
    cd zync
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run in development mode:**
    ```bash
    npm run tauri dev
    ```

4.  **Build for production:**
    ```bash
    npm run tauri build
    ```

## 📄 License

MIT © [Zync](https://github.com/FDgajju/zync)
