#!/bin/bash

# Default values
create_pr=false
generate_description=false

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
echo "icrewsystems PR assist script (c) 2023 - authors: Leonard, Thirumalai"
echo ""
# Dashes for separation
echo "---------------------------------------------------------------------------"
echo ""

echo -n "Hi 👋"
echo ""

# Stop the task timer if running
# Extract task ID from branch name
branch_name=$(git rev-parse --abbrev-ref HEAD)
if [[ $branch_name =~ ^([a-zA-Z]+)_task_([0-9]+)$ ]]; then
    task_id="${BASH_REMATCH[2]}"
    read -p "Enter your timer stop token: " token
    stop_response=$(curl -s -X  GET "https://cerebro.icrewsystems.com/api/v1/stop-timer/$task_id?token=$token")

    # Extract hours from the response
    total_hours_spent=$(echo "$stop_response" | grep -oP '"hours":\s*"\K[^"]+')
    message=$(echo "$stop_response" | grep -oP '"message":\s*"\K[^"]+')

    # Display the timer stop response and total hours spent
    echo "Timer stop response: $message"
    echo "Total hours spent on task $task_id: $total_hours_spent"
else
    echo "Whoops! The current branch name doesn't match the format specified by icrewsystems."
    exit 1
fi

# Prompt the user if they want to create a new PR
read -p "Do you want to create a new pull-request on Github for this branch? (y/n): " create_pr_input
if [[ $create_pr_input =~ ^[Yy]$ ]]; then
    create_pr=true
elif [[ ! $create_pr_input =~ ^[Nn]$ ]]; then
    echo "Invalid input 😡 Please enter 'y' or 'n'."
    exit 1
fi

echo "---------------------------------------------------------------------------"
echo "⬇️ COPY FROM HERE ⬇️"
echo "---------------------------------------------------------------------------"
echo ""

# Extract author name from branch name
author_name="${BASH_REMATCH[1]}"
author_name="$(tr '[:lower:]' '[:upper:]' <<< ${author_name:0:1})${author_name:1}"

# Get the base branch name (e.g., "main")
base_branch="main" # Change this to your main branch name

# Get the list of files changed in the PR compared to the main branch
changed_files=$(git diff --name-only $base_branch...$branch_name)

# Fetch the task title from the URL
task_title=$(curl -s "https://cerebro.icrewsystems.com/api/v1/get-task-title/$task_id")

# PR Title
pr_title="## $author_name | Task #$task_id - $task_title"
echo "$pr_title"
echo ""

echo "#### PR Description:"
echo ""
echo "Please go view [Task #$task_id](https://icrewsystems.com/portal/index.php/tasks/view/$task_id) on the portal to understand about the exact requirements of this task"
echo ""

# Checklist
echo "## PR Checklist:"
echo "### I, $author_name have verified to the best of my abilities that:"
echo "- [ ] This pull request covers all the expectations outlined in the task description"
echo "- [ ] All files that have been modified in the \"app\" folder have PHP \`doc blocks\`"
echo "- [ ] The code that I have written, follows DRY & SOLID principles"
echo "- [ ] I have provided updates / proof of work on the portal with screenshots"
echo ""

# Files changed
echo "### Files changed in this PR:"
for file in $changed_files; do
    echo " - $file"
done
echo ""

# PSR Compliance Check
echo "### PSR Compliance Check:"
if command -v phpcs >/dev/null 2>&1; then
    psr_errors=$(phpcs --standard=PSR12 $changed_files)
    if [[ -z "$psr_errors" ]]; then
        echo "- All files follow the PSR-12 standard."
    else
        echo "- PSR-12 violations found:"
        echo "$psr_errors"
    fi
else
    echo "PHP CodeSniffer (phpcs) is not installed. Please install it for PSR checks."
fi
echo ""

# Count TODO, BUG, FIXME
todo_count=$(grep -Ei "TODO|BUG|FIXME" $changed_files | wc -l)
echo "### TODO/Bug/Fixme Check:"
echo "- Total TODO/BUG/FIXME items: $todo_count"
echo ""

# Additional commands to run
echo "---"
echo "### Additional commands to run while merging PR?"
commands_to_run=0

if [[ $changed_files == *"composer."* ]]; then
    echo "  - Run \`composer install\` because \`composer.json\` or \`composer.lock\` file was modified."
    commands_to_run=1
fi
if [[ $changed_files == *"config/"*".php"* ]]; then
    echo "  - Run \`php artisan config:cache\` because a configuration file in \`config/\` was modified."
    commands_to_run=1
fi
if [[ $changed_files == *".env.example"* ]]; then
    echo "  - **ALERT**: \`.env.example\` variable updated. Please update and run \`php artisan config:cache\`."
    commands_to_run=1
fi
if [[ $changed_files == *"/database/migrations/"* ]]; then
    echo "  - Run \`php artisan migrate\` because a migration file in \`/database/migrations/\` was modified."
    commands_to_run=1
fi
if [[ $changed_files == *"routes/web.php"* ]] || [[ $changed_files == *"routes/api.php"* ]]; then
    echo "  - Run \`php artisan route:cache\` because \`routes/web.php\` or \`routes/api.php\` was modified."
    commands_to_run=1
fi

if [ "$commands_to_run" -eq 0 ]; then
    echo "# No 😊✅ "
    echo ""
fi
echo ""

# Tests added?
echo "---"
echo -n "#### Does this PR have test coverage? (changes in /tests directory) "
echo ""
if [[ $changed_files == *"tests/"* ]]; then
    echo -n "# Yes 😊"
else
    echo -n "# No 😰 "
fi
echo ""

# File-based checklist
echo "### File-based Checklist:"
for file in $changed_files; do
    if [[ "$file" == *"Model"* ]]; then
        echo "- Model: $file"
        echo "  - [ ] Includes timestamps?"
        echo "  - [ ] Has relationships? If yes, are they configured properly?"
        echo "  - [ ] Has scope?"
        echo "  - [ ] Has mutators?"
    elif [[ "$file" == *"Controller"* ]]; then
        echo "- Controller: $file"
        echo "  - [ ] All methods have PHPDoc blocks"
        echo "  - [ ] All methods are strongly typed"
    fi
done

if [ "$create_pr" = true ]; then
    # Get the GitHub repository and organization name from the Git remote URL
    remote_url=$(git config --get remote.origin.url)
    repo_name=$(basename -s .git $remote_url)
    org_name=$(basename $(dirname $remote_url))

    # Open the GitHub PR creation URL
    github_url="https://github.com/$org_name/$repo_name/pull/new/$branch_name"
    open "$github_url"
fi
