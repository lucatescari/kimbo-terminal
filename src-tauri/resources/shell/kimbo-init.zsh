# Kimbo shell integration — emits OSC 133 sequences for command start/end.
# Source this from your ~/.zshrc:
#   source ~/.config/kimbo/shell/kimbo-init.zsh

_kimbo_precmd() { printf '\e]133;D;%s\e\\' "$?"; }
_kimbo_preexec() { printf '\e]133;C\e\\'; }

# Only hook once.
if ! (( ${precmd_functions[(Ie)_kimbo_precmd]} )); then
    precmd_functions+=(_kimbo_precmd)
fi
if ! (( ${preexec_functions[(Ie)_kimbo_preexec]} )); then
    preexec_functions+=(_kimbo_preexec)
fi

# imgcat — render a local image inline using the iTerm2 OSC 1337 protocol
# that Kimbo's renderer parses. Skipped if an `imgcat` binary is already on
# PATH (e.g. iTerm2's bundled one) so we don't shadow a richer impl.
if ! command -v imgcat >/dev/null 2>&1; then
    imgcat() {
        emulate -L zsh
        if (( $# == 0 )); then
            print -u2 "usage: imgcat <file>..."
            return 1
        fi
        local file name b64name b64data size
        for file in "$@"; do
            if [[ ! -f "$file" ]]; then
                print -u2 "imgcat: not found: $file"
                continue
            fi
            name=${file:t}
            size=$(wc -c < "$file" | tr -d ' ')
            b64name=$(printf %s "$name" | base64 | tr -d '\n')
            b64data=$(base64 < "$file" | tr -d '\n')
            printf '\e]1337;File=name=%s;inline=1;size=%d:%s\a\n' "$b64name" "$size" "$b64data"
        done
    }
fi
