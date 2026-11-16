{
  description = "Setwise local music library development tools";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forEachSystem (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_24 (pkgs.python3.withPackages (ps: [ ps.ytmusicapi ])) ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.gnumake pkgs.gcc ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.xcodegen pkgs.swift pkgs.swiftPackages.swiftpm ];
          };
        });
    };
}
