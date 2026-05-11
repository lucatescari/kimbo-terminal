# Kimbo shell integration — emits OSC 133 sequences for command start/end.
# Source this from your ~/.bashrc:
#   source ~/.config/kimbo/shell/kimbo-init.bash

_kimbo_preexec() {
    # Skip completion and prompt-command internals.
    [[ -n "$COMP_LINE" ]] && return
    [[ "$BASH_COMMAND" == *"_kimbo_precmd"* ]] && return
    printf '\e]133;C\e\\'
}
_kimbo_precmd() { printf '\e]133;D;%s\e\\' "$?"; }

# Install the DEBUG trap, composing with any existing trap instead of clobbering it.
if [[ "$(trap -p DEBUG)" != *"_kimbo_preexec"* ]]; then
    _kimbo_existing_debug=$(trap -p DEBUG 2>/dev/null | sed -n "s/^trap -- '\\(.*\\)' DEBUG\$/\\1/p")
    if [[ -n "$_kimbo_existing_debug" ]]; then
        trap "${_kimbo_existing_debug}; _kimbo_preexec" DEBUG
    else
        trap '_kimbo_preexec' DEBUG
    fi
    unset _kimbo_existing_debug
fi

# Append (not prepend) kimbo's precmd to PROMPT_COMMAND; handle unset/empty safely.
if [[ "$PROMPT_COMMAND" != *"_kimbo_precmd"* ]]; then
    PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND; }_kimbo_precmd"
fi

# imgcat — render a local image inline using the iTerm2 OSC 1337 protocol
# that Kimbo's renderer parses. Skipped if an `imgcat` binary is already on
# PATH (e.g. iTerm2's bundled one) so we don't shadow a richer impl.
if ! command -v imgcat >/dev/null 2>&1; then
    imgcat() {
        if [[ $# -eq 0 ]]; then
            echo "usage: imgcat <file>..." >&2
            return 1
        fi
        local file name b64name b64data size
        for file in "$@"; do
            if [[ ! -f "$file" ]]; then
                echo "imgcat: not found: $file" >&2
                continue
            fi
            name=$(basename -- "$file")
            size=$(wc -c < "$file" | tr -d ' ')
            b64name=$(printf %s "$name" | base64 | tr -d '\n')
            b64data=$(base64 < "$file" | tr -d '\n')
            printf '\e]1337;File=name=%s;inline=1;size=%d:%s\a\n' "$b64name" "$size" "$b64data"
        done
    }
fi
