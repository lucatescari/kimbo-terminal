# Kimbo shell integration — emits OSC 133 sequences for command start/end.
# Source this from your ~/.config/fish/config.fish:
#   source ~/.config/kimbo/shell/kimbo-init.fish

function _kimbo_preexec --on-event fish_preexec
    printf '\e]133;C\e\\'
end

function _kimbo_postexec --on-event fish_postexec
    printf '\e]133;D;%s\e\\' $status
end

# imgcat — render a local image inline using the iTerm2 OSC 1337 protocol
# that Kimbo's renderer parses. Skipped if an `imgcat` binary is already on
# PATH (e.g. iTerm2's bundled one) so we don't shadow a richer impl.
if not command -q imgcat
    function imgcat
        if test (count $argv) -eq 0
            echo "usage: imgcat <file>..." >&2
            return 1
        end
        for file in $argv
            if not test -f "$file"
                echo "imgcat: not found: $file" >&2
                continue
            end
            set -l name (basename -- "$file")
            set -l size (wc -c < "$file" | tr -d ' ')
            set -l b64name (printf %s "$name" | base64 | tr -d '\n')
            set -l b64data (base64 < "$file" | tr -d '\n')
            printf '\e]1337;File=name=%s;inline=1;size=%d:%s\a\n' "$b64name" "$size" "$b64data"
        end
    end
end
