# Kimbo shell integration — emits OSC 133 sequences for command start/end.
# Source this from your ~/.config/fish/config.fish:
#   source ~/.config/kimbo/shell/kimbo-init.fish

function _kimbo_preexec --on-event fish_preexec
    printf '\e]133;C\e\\'
end

function _kimbo_postexec --on-event fish_postexec
    printf '\e]133;D;%s\e\\' $status
end
