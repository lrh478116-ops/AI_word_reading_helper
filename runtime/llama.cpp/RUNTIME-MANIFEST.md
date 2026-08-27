# Bundled llama.cpp runtime

- Upstream: `ggml-org/llama.cpp`
- Version: `b10545`
- License: MIT (the upstream `LICENSE` is included in every platform directory)
- Release date pinned by this build: 2026-08-21

Build artifacts included with the app:

| Platform | Official release asset | Archive SHA-256 |
| --- | --- | --- |
| Windows x64 CPU | `llama-b10545-bin-win-cpu-x64.zip` | `475e2720a6dec6e0e10c58b37461c140cf9523f4efb373cb5b65ae7e4ff6b4cf` |
| macOS arm64 | `llama-b10545-bin-macos-arm64.tar.gz` | `c94b6cf341c23e2aff57cc0539aa9e32966d59f0ae2f723636e9e4379804c25a` |
| macOS x64 | `llama-b10545-bin-macos-x64.tar.gz` | `0fa8f0d038f3084ccea60b6541139350f5bbfdc4d2f14ee708398baf169a32f0` |

These executables are application resources, not downloaded at runtime. Model files are GGUF data and are downloaded separately only after explicit user confirmation.
