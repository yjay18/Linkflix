#!/bin/bash
set -e

echo "Downloading Ollama macOS binary..."

BIN_DIR="models/bin"
mkdir -p "$BIN_DIR"

if [ -d "$BIN_DIR/ollama-mac" ]; then
    echo "Ollama bundle already exists at $BIN_DIR/ollama-mac."
    exit 0
fi

TMP_DIR=$(mktemp -d)
echo "Downloading Ollama-darwin.zip..."
curl -L -s "https://github.com/ollama/ollama/releases/latest/download/Ollama-darwin.zip" -o "$TMP_DIR/Ollama-darwin.zip"

echo "Unzipping..."
unzip -q "$TMP_DIR/Ollama-darwin.zip" -d "$TMP_DIR"

echo "Extracting binary and dependencies..."
rm -rf "$BIN_DIR/ollama-mac"
mv "$TMP_DIR/Ollama.app/Contents/Resources" "$BIN_DIR/ollama-mac"
chmod +x "$BIN_DIR/ollama-mac/ollama"
chmod +x "$BIN_DIR/ollama-mac/llama-server"

echo "Cleaning up..."
rm -rf "$TMP_DIR"
rm -f "$BIN_DIR/ollama-darwin"

echo "Ollama bundled successfully in $BIN_DIR/ollama-mac"
