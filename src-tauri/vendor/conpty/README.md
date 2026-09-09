# Windows ConPTY redistributable

Local PowerShell/CMD PTYs use Windows ConPTY. The in-box host **drops Sixel DCS**, so `fastfetch` / `chafa` logos never reach xterm. Windows Terminal sideloads its own `conpty.dll` + `OpenConsole.exe`; Zync does the same.

Source: NuGet `Microsoft.Windows.Console.ConPTY` **1.24.260710001** (MIT, Windows Terminal). `build.rs` downloads that nupkg, verifies SHA-256, and extracts:

- `x64/conpty.dll` + `x64/OpenConsole.exe`
- `arm64/conpty.dll` + `arm64/OpenConsole.exe`

Do not mix versions of the two files. Keep them next to each other. `build.rs` writes `.nupkg-sha256` next to each pair; a cached dll/exe is reused only when that pin matches the SHA-256 in `build.rs`.

Windows **release** builds fail if the pair for the target arch is missing (`curl` + nuget.org, or a cached nupkg). Debug/`tauri dev` warns and continues with in-box conhost (Sixel stripped).
