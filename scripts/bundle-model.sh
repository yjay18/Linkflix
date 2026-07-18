#!/bin/bash
set -e

echo "Downloading Xenova/all-MiniLM-L6-v2 model for offline semantic search..."

MODEL_DIR="models/Xenova/all-MiniLM-L6-v2"
mkdir -p "$MODEL_DIR/onnx"

BASE_URL="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main"

download_file() {
    local file=$1
    if [ ! -f "$MODEL_DIR/$file" ]; then
        echo "Downloading $file..."
        curl -L -s "$BASE_URL/$file" -o "$MODEL_DIR/$file"
    else
        echo "$file already exists."
    fi
}

download_file "config.json"
download_file "special_tokens_map.json"
download_file "tokenizer.json"
download_file "tokenizer_config.json"
download_file "vocab.txt"
download_file "onnx/model_quantized.onnx"

echo "Model bundled successfully in $MODEL_DIR"

echo "Copying ONNX runtime wasm files from node_modules..."
mkdir -p js/vendor
cp node_modules/@xenova/transformers/dist/ort-wasm*.wasm js/vendor/
echo "Done. (js/vendor/transformers.mjs is a customized build — kept in git.)"
