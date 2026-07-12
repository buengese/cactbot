{ pkgs ? import <nixpkgs> { } }:

# Dev shell for working on cactbot triggers/timelines.
#   nix-shell          # enter the shell (Node 22 LTS on PATH)
#   install-deps       # one-time: npm install
#   start-emulator     # npm start -> raidboss emulator at localhost:8080

let
  install-deps = pkgs.writeShellScriptBin "install-deps" ''
    exec npm install "$@"
  '';

  start-emulator = pkgs.writeShellScriptBin "start-emulator" ''
    echo "raidboss emulator: http://localhost:8080/ui/raidboss/raidemulator.html"
    echo "(Ctrl-C to stop)"
    exec npm start "$@"
  '';
in
pkgs.mkShell {
  packages = [
    pkgs.nodejs_22
    install-deps
    start-emulator
  ];

  shellHook = ''
    echo "cactbot dev shell (node $(node --version), npm $(npm --version))"
    echo "  install-deps    - npm install (run once)"
    echo "  start-emulator  - npm start  (http://localhost:8080/ui/raidboss/raidemulator.html)"
  '';
}
