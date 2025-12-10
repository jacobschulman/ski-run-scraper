#!/bin/bash
# Sync HTML templates to all resort directories
# Usage: ./scripts/sync-templates.sh [resort]
# If no resort specified, syncs to all resorts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATES_DIR="$ROOT_DIR/data/_templates"
DATA_DIR="$ROOT_DIR/data"

# Templates to sync
TEMPLATES=("grooming.html" "lifts.html" "snow.html" "trails.html")

# Check templates exist
if [ ! -d "$TEMPLATES_DIR" ]; then
    echo "Error: Templates directory not found at $TEMPLATES_DIR"
    exit 1
fi

sync_resort() {
    local resort=$1
    local resort_dir="$DATA_DIR/$resort"

    if [ ! -d "$resort_dir" ]; then
        echo "  Skipping $resort (no directory)"
        return
    fi

    for template in "${TEMPLATES[@]}"; do
        if [ -f "$TEMPLATES_DIR/$template" ]; then
            # Only copy if the resort has this template type
            # (check if they have the corresponding data)
            case $template in
                "snow.html")
                    if [ -d "$resort_dir/snow" ]; then
                        cp "$TEMPLATES_DIR/$template" "$resort_dir/$template"
                    fi
                    ;;
                "lifts.html")
                    if [ -d "$resort_dir/lifts" ]; then
                        cp "$TEMPLATES_DIR/$template" "$resort_dir/$template"
                    fi
                    ;;
                "trails.html"|"grooming.html")
                    if [ -d "$resort_dir/trails" ] || [ -d "$resort_dir/terrain" ]; then
                        cp "$TEMPLATES_DIR/$template" "$resort_dir/$template"
                    fi
                    ;;
            esac
        fi
    done
    echo "  ✓ $resort"
}

if [ -n "$1" ]; then
    # Sync specific resort
    echo "Syncing templates to $1..."
    sync_resort "$1"
else
    # Sync all resorts
    echo "Syncing templates to all resorts..."
    for resort_dir in "$DATA_DIR"/*/; do
        resort=$(basename "$resort_dir")
        # Skip special directories
        if [[ "$resort" == "_templates" ]] || [[ "$resort" == "." ]]; then
            continue
        fi
        sync_resort "$resort"
    done
fi

echo "Done!"
