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
