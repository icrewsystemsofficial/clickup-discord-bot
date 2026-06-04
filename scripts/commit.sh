#!/bin/bash

# Colors for text styling
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Dashes for separation
echo "---------------------------------------------------------------------------"
# ASCII art
echo "  _                                              _                        "
echo " (_)                                            | |                       "
echo "  _   ___  _ __  ___ __      __ ___  _   _  ___ | |_  ___  _ __ ___   ___ "
echo " | | / __|| '__|/ _ \\ \ /\ / // __|| | | |/ __|| __|/ _ \| '_ \` _ \ / __|"
echo " | || (__ | |  |  __/ \ V  V / \__ \| |_| |\__ \| |_|  __/| | | | | |\__ \\"
echo " |_| \___||_|   \___|  \_/\_/  |___/ \__, ||___/ \__|\___||_| |_| |_||___/"
echo "                                      __/ |                               "
echo "                                     |___/                                "
echo -e "${BLUE}icrewsystems commit assist script (c) November 2024 - authors: Leonard ${NC}"
echo ""
# Dashes for separation
echo "---------------------------------------------------------------------------"
echo ""


# Show options with colors
show_help() {
  echo -e "${YELLOW}Usage: ./commit-helper.sh [options]${NC}"
  echo -e "${GREEN}Options:${NC}"
  echo -e "  ${BLUE}-a, --add${NC}           Stage all changes"
  echo -e "  ${BLUE}-m, --message${NC}       Specify a commit message"
  echo -e "  ${BLUE}-p, --push${NC}          Push changes after committing"
  echo -e "  ${BLUE}-h, --help${NC}          Show this help message"
}

# Commit types
select_commit_type() {
  echo -e "${YELLOW}Select the commit type:${NC}"
  echo -e "1) ${GREEN}SETUP${NC} - Initial setup tasks or configuration changes"
  echo -e "2) ${GREEN}WIP${NC} - Ongoing work or progress on a task (client-hidden)"
  echo -e "3) ${GREEN}PROGRESS${NC} - Task checkpoint; achieved milestone"
  echo -e "4) ${GREEN}BUG${NC} - Bug identification or tracking (client-hidden)"
  echo -e "5) ${GREEN}FIX${NC} - Resolving a bug or specific issue"
  echo -e "6) ${GREEN}REFACTOR${NC} - Refactoring code without changing functionality"
  echo -e "7) ${GREEN}REVIEW${NC} - Code review or improvements based on feedback"
  echo -e "8) ${RED}Quit${NC}"
  read -p "Enter the number of your choice: " choice

  case $choice in
    1) commit_type="SETUP" ;;
    2) commit_type="WIP" ;;
    3) commit_type="PROGRESS" ;;
    4) commit_type="BUG" ;;
    5) commit_type="FIX" ;;
    6) commit_type="REFACTOR" ;;
    7) commit_type="REVIEW" ;;
    8) echo -e "${RED}Exiting.${NC}"; exit 0 ;;
    *) echo -e "${RED}Invalid choice. Exiting.${NC}"; exit 1 ;;
  esac
}

# Extract the task ID from the branch name
extract_task_id() {
  branch_name=$(git rev-parse --abbrev-ref HEAD)
  if [[ $branch_name =~ _task_([0-9]+) ]]; then
    task_id="${BASH_REMATCH[1]}"
    echo -e "${GREEN}Extracted Task ID: ${task_id}${NC}"
  else
    echo -e "${RED}No task ID found in branch name. Make sure branch name follows USERNAME_task_ID format.${NC}"
    task_id="0000" # Default if no task ID is found
  fi
}

# Initialize variables
commit_message=""
add_changes=false
push_changes=false

# Parse options
while [[ "$#" -gt 0 ]]; do
  case $1 in
    -a|--add) add_changes=true ;;
    -m|--message) commit_message="$2"; shift ;;
    -p|--push) push_changes=true ;;
    -h|--help) show_help; exit 0 ;;
    *) echo -e "${RED}Unknown option:${NC} $1"; show_help; exit 1 ;;
  esac
  shift
done

# Prompt for commit type and extract task ID
extract_task_id
select_commit_type


# Interactive commit message builder if no message is provided
if [ -z "$commit_message" ]; then
  echo -e "${YELLOW}Enter your commit message: ${NC}"
  read -r commit_message
fi

# Format the commit message, adding a space after # if type is WIP or BUG
if [[ "$commit_type" == "WIP" || "$commit_type" == "BUG" ]]; then
  final_commit_message="[$commit_type] Task # $task_id | $commit_message (this commit will be ignored by portal since it's a $commit_type)"
else
  final_commit_message="[$commit_type] Task #$task_id | $commit_message"
fi

# Stage changes if selected
if $add_changes; then
  git add -A
  echo -e "${GREEN}All changes staged.${NC}"
fi

# Commit changes
if [ -n "$final_commit_message" ]; then
  git commit -m "$final_commit_message"
  echo -e "${GREEN}Committed with message:${NC} '$final_commit_message'"
else
  echo -e "${RED}No commit message provided, skipping commit.${NC}"
fi

# Push changes if selected
if $push_changes; then
  git push
  echo -e "${GREEN}Changes pushed to remote.${NC}"
fi

echo -e "${BLUE}Done!${NC}"
