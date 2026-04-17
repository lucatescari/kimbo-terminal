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
