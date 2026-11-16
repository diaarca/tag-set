{
  description = "Setwise YouTube Music wrapper";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in {
      apps = forEachSystem (system:
        let
          pkgs = import nixpkgs { inherit system; };
          linuxRuntime = target: (import nixpkgs { system = target; }).electron-bin.src;
          windowsRuntime = pkgs.fetchurl {
            url = "https://github.com/electron/electron/releases/download/v${pkgs.electron-bin.version}/electron-v${pkgs.electron-bin.version}-win32-x64.zip";
            sha256 = "489cd061908e697394b004298bf5ffd345c935d10e8ca197ba819f019ab2dec0";
          };
          command = name: inputs: script: arguments: {
            type = "app";
            program = "${pkgs.writeShellApplication {
              name = "setwise-${name}";
              runtimeInputs = [ pkgs.nodejs_24 ] ++ inputs;
              text = ''
                exec node ${pkgs.lib.escapeShellArg script} ${pkgs.lib.escapeShellArgs arguments} "$@"
              '';
            }}/bin/setwise-${name}";
          };
        in {
          windows = command "windows" [ pkgs.unzip pkgs.nsis ] "wrapper/package-desktop.mjs" [ "windows-x64" "${windowsRuntime}" ];
          linux = command "linux" [ pkgs.unzip pkgs.gnutar pkgs.gzip ] "wrapper/package-desktop.mjs" [ "linux-x64" "${linuxRuntime "x86_64-linux"}" ];
          linux-arm64 = command "linux-arm64" [ pkgs.unzip pkgs.gnutar pkgs.gzip ] "wrapper/package-desktop.mjs" [ "linux-arm64" "${linuxRuntime "aarch64-linux"}" ];
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
          dmg = command "dmg" [] "wrapper/package-macos.mjs" [ "${pkgs.electron.src}" ];
          ios = command "ios" [ pkgs.xcodegen ] "wrapper/package-ios.mjs" [];
        });
      devShells = forEachSystem (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_24 pkgs.electron-bin ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.xcodegen ];
          };
        });
    };
}
