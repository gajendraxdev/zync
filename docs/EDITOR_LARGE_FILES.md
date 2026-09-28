# Large files in the file editor

## Current safety policy

Zync's file editor currently transfers a complete text document through IPC and keeps an editor model for it. To avoid surprising memory and network use, opening a file larger than 8 MiB is refused before the read when the directory listing has a known size. The desktop backend also bounds the actual local or SFTP read to 8 MiB plus one byte; a missing or stale listing size cannot bypass the limit. No truncated document is presented for editing, because saving it could destroy the unseen remainder. Files at the boundary are allowed. This applies to CodeMirror and plugin editor providers alike. Other file operations (download, copy, upload) are unaffected.

An SFTP listing may report size zero when the server omits it, and files may change between listing and opening. The backend's bounded read is authoritative. This policy does not make editing near the limit cheap: both IPC and the editor still hold complete copies. Plugin large-document modes can reduce editor features, but cannot remove these copies.

## Later: true partial editing

Removing the limit safely needs more than streaming the initial download. Monaco and CodeMirror normally hold a complete document model. A later design should:

1. Provide a versioned, bounded range-read API for local and SFTP files with byte offsets, total size, encoding detection, and an explicit EOF indication. Never send paths or file contents to a remote service.
2. Use a viewport/window editor model for large documents. Define line indexing and navigation without building a full in-memory line map. Keep small-file editing on the existing editor path.
3. Store edits as a bounded patch journal rather than a full replacement string. Preserve undo/redo semantics across unloaded ranges, and warn when an operation would exceed the memory budget.
4. Save through a staged local or remote file, verify the source version/size before commit, then atomically replace where supported. Specify recovery for interrupted writes and SFTP servers without atomic rename guarantees. Never overwrite unseen content based on a truncated read.
5. Test UTF-8 boundaries, multibyte characters, long lines, mixed newlines, concurrent external changes, disconnect/reconnect, cancellation, sparse files, and files larger than available RAM. Measure renderer, backend, and SFTP memory separately.

Until those contracts exist, the 8 MiB refusal is intentional. Increasing the number alone would not deliver safe large-file support.
