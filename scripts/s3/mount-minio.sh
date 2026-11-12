#!/usr/bin/env bash
set -euo pipefail

# Mount a MinIO bucket directly with s3fs/FUSE.
#
# Usage:
#   mount-minio.sh <minio-url-with-bucket> [mount-point]
#   mount-minio.sh --unmount <minio-url-with-bucket> [mount-point]
#
# MINIO_CREDS is read from the environment and written only to a mode-600
# temporary passwd file. It is never placed in the process arguments.

unmount=0
if [[ "${1:-}" == "--unmount" ]]; then
    unmount=1
    shift
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
    printf 'Usage: %s [--unmount] <minio-url-with-bucket> [mount-point]\n' "$0" >&2
    exit 64
fi

source_url=$1
mount_point=${2:-}

# Keep URL parsing in Ruby's standard library rather than reimplementing URL
# escaping in shell. The output contains no credentials.
read -r endpoint bucket default_name < <(
    ruby -ruri -e '
      raw = ARGV.fetch(0)
      uri = URI.parse(raw)
      abort "MinIO URL must use http or https" unless %w[http https].include?(uri.scheme)
      abort "MinIO URL must include a host" if uri.host.to_s.empty?
      parts = uri.path.to_s.split("/").reject(&:empty?)
      abort "MinIO URL must include a bucket path" if parts.empty?
      abort "s3fs mounts a bucket root only; use a bucket URL without a prefix" if parts.length != 1
      endpoint = "#{uri.scheme}://#{uri.host}"
      endpoint += ":#{uri.port}" unless (uri.scheme == "http" && uri.port == 80) || (uri.scheme == "https" && uri.port == 443)
      bucket = parts.fetch(0)
      slug = ([uri.host, (uri.port unless [80, 443].include?(uri.port)), bucket].compact.join("_").gsub(/[^A-Za-z0-9._-]+/, "_").sub(/\A[._-]+/, ""))
      puts [endpoint, bucket, slug].join("\t")
    ' "$source_url"
)

if [[ -z "$mount_point" ]]; then
    mount_point="$HOME/s3mount/$default_name"
fi
mount_point=${mount_point/#\~\//$HOME/}

if [[ "$unmount" == "1" ]]; then
    mounted_target=$(findmnt -rn -T "$mount_point" -o TARGET 2>/dev/null || true)
    if [[ "$mounted_target" != "$mount_point" ]]; then
        printf 'Not mounted: %s\n' "$mount_point"
        exit 0
    fi
    if fusermount3 -u "$mount_point" 2>/dev/null || fusermount -u "$mount_point" 2>/dev/null; then
        printf 'Unmounted: %s\n' "$mount_point"
        exit 0
    fi
    if fusermount3 -uz "$mount_point" 2>/dev/null || fusermount -uz "$mount_point" 2>/dev/null; then
        printf 'Lazy-unmounted: %s\n' "$mount_point"
        exit 0
    fi
    printf 'Could not unmount: %s\n' "$mount_point" >&2
    exit 1
fi

command -v s3fs >/dev/null 2>&1 || { printf 's3fs is required but was not found in PATH\n' >&2; exit 69; }
: "${MINIO_CREDS:?MINIO_CREDS must contain access-key:secret-key}"
if [[ "$MINIO_CREDS" != *:* ]]; then
    printf 'MINIO_CREDS must contain access-key:secret-key\n' >&2
    exit 64
fi
access_key=${MINIO_CREDS%%:*}
secret_key=${MINIO_CREDS#*:}
if [[ -z "$access_key" || -z "$secret_key" ]]; then
    printf 'MINIO_CREDS must contain non-empty access and secret keys\n' >&2
    exit 64
fi

print_mount_link() {
    local file_url
    file_url=$(ruby -ruri -e 'puts URI::DEFAULT_PARSER.escape("file://#{ARGV.fetch(0)}")' "$mount_point")
    # OSC 8 is the clickable-link convention supported by GNOME Terminal.
    printf 'Mounted directory: \033]8;;%s\a%s\033]8;;\a\n' "$file_url" "$file_url"
}

open_mount_directory() {
    [[ "${S3_MOUNT_OPEN:-1}" == "0" ]] && return 0
    if command -v gio >/dev/null 2>&1; then
        nohup gio open "$1" >/dev/null 2>&1 </dev/null &
    elif command -v xdg-open >/dev/null 2>&1; then
        nohup xdg-open "$1" >/dev/null 2>&1 </dev/null &
    fi
}

mkdir -p "$(dirname "$mount_point")"
mounted_target=$(findmnt -rn -T "$mount_point" -o TARGET 2>/dev/null || true)
if [[ "$mounted_target" == "$mount_point" ]]; then
    # A live MinIO mount can take a few seconds to answer its first listing.
    if timeout 10 ls -A "$mount_point" >/dev/null 2>&1; then
        print_mount_link
        [[ "${S3_MOUNT_BACKGROUND:-0}" == "1" ]] && open_mount_directory "$(ruby -ruri -e 'puts URI::DEFAULT_PARSER.escape("file://#{ARGV.fetch(0)}")' "$mount_point")"
        exit 0
    fi
    printf 'Removing stale FUSE mount: %s\n' "$mount_point" >&2
    if ! fusermount3 -u "$mount_point" 2>/dev/null && ! fusermount -u "$mount_point" 2>/dev/null; then
        if ! fusermount3 -uz "$mount_point" 2>/dev/null && ! fusermount -uz "$mount_point" 2>/dev/null; then
            printf 'Could not unmount stale FUSE mount: %s\n' "$mount_point" >&2
            exit 1
        fi
    fi
fi
mkdir -p "$mount_point"

if [[ "${S3_MOUNT_DRY_RUN:-}" == "1" ]]; then
    printf 'driver=s3fs\nendpoint=%s\nbucket=%s\nmount_point=%s\nbackground=%s\n' \
        "$endpoint" "$bucket" "$mount_point" "${S3_MOUNT_BACKGROUND:-0}"
    exit 0
fi

passwd_file=$(mktemp "${TMPDIR:-/tmp}/s3fs-pass.XXXXXX")
trap 'rm -f "$passwd_file"' EXIT
printf '%s:%s\n' "$access_key" "$secret_key" > "$passwd_file"
chmod 600 "$passwd_file"

s3fs_args=(
    "$bucket" "$mount_point"
    -o "passwd_file=$passwd_file"
    -o "url=$endpoint"
    -o use_path_request_style
    -o listobjectsv2
    -o endpoint=us-east-1
    -o umask=022
)
[[ "${S3_MOUNT_S3FS_SIGV2:-0}" == "1" ]] && s3fs_args+=(-o sigv2)
if [[ -n "${S3_MOUNT_LOG_FILE:-}" ]]; then
    s3fs_args+=(-o "logfile=$S3_MOUNT_LOG_FILE")
fi
if [[ "${S3_MOUNT_S3FS_DEBUG:-0}" == "1" ]]; then
    s3fs_args+=(-o dbglevel=info -o curldbg)
fi

if [[ "${S3_MOUNT_BACKGROUND:-0}" == "1" ]]; then
    s3fs "${s3fs_args[@]}"
    mounted=0
    for _ in {1..20}; do
        mounted_target=$(findmnt -rn -T "$mount_point" -o TARGET 2>/dev/null || true)
        if [[ "$mounted_target" == "$mount_point" ]]; then
            mounted=1
            break
        fi
        sleep 0.5
    done
    rm -f "$passwd_file"
    trap - EXIT
    if [[ "$mounted" != "1" ]]; then
        printf 's3fs did not mount %s at %s\n' "$bucket" "$mount_point" >&2
        exit 1
    fi
    print_mount_link
    open_mount_directory "$(ruby -ruri -e 'puts URI::DEFAULT_PARSER.escape("file://#{ARGV.fetch(0)}")' "$mount_point")"
else
    printf 'Mounting %s at %s with s3fs (Ctrl-C to unmount)\n' "$bucket" "$mount_point"
    s3fs -f "${s3fs_args[@]}"
fi
