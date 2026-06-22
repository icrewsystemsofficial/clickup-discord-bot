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
echo "icrewsystems PR assist script (c) 2023 - authors: Leonard, Thirumalai, Santhosh"
echo ""
# Dashes for separation
echo "---------------------------------------------------------------------------"
echo ""



echo -n "Hi 👋"
echo ""

# Prompt the user if they want to create a new PR
read -p "Do you want to create a new pull-request on Github for this branch? (y/n): " create_pr_input
if [[ $create_pr_input =~ ^[Yy]$ ]]; then
    create_pr=true
elif [[ ! $create_pr_input =~ ^[Nn]$ ]]; then
    echo "Invalid input 😡 Please enter 'y' or 'n'."
    exit 1
fi

echo "---------------------------------------------------------------------------"
echo "Checking PR Checklist..."
echo "---------------------------------------------------------------------------"

checklist_items=(
    "This pull request covers all the expectations outlined in the task description"
    "All files that have been modified in the 'app' folder have PHP doc blocks"
    "The code that I have written follows DRY & SOLID principles"
    "I have provided updates / proof of work on the portal with screenshots"
)

checklist_status=()

for item in "${checklist_items[@]}"; do
    read -p "$item (y/n): " response
    if [[ $response =~ ^[Yy]$ ]]; then
        checklist_status+=("- [x] $item")
    else
        checklist_status+=("- [ ] $item")
    fi
done

# Prompt for JAM video link
echo "---------------------------------------------------------------------------"
read -p "Enter JAM video link (leave empty if not available): " jam_link
if [[ -z "$jam_link" ]]; then
    jam_link="No Jam link provided"
fi

echo "---------------------------------------------------------------------------"
echo "⬇️ COPY FROM HERE ⬇️"
echo "---------------------------------------------------------------------------"
echo ""

# Get current branch name
branch_name=$(git rev-parse --abbrev-ref HEAD)

# Extract task ID and author's name from branch name
if [[ $branch_name =~ ^([a-zA-Z]+)_task_([0-9]+)$ ]]; then
    author_name="${BASH_REMATCH[1]}"
    task_id="${BASH_REMATCH[2]}"

    # Convert author's name to title case
    author_name="$(tr '[:lower:]' '[:upper:]' <<< ${author_name:0:1})${author_name:1}"

    # Get the base branch name (e.g., "main")
    base_branch="main" # Change this to your main branch name

    # Get the list of files changed in the PR compared to the main branch
    changed_files=$(git diff --name-only $base_branch...$branch_name)

    # Fetch the task title from the URL
    task_title=$(curl -s "https://cerebro.icrewsystems.com/api/v1/get-task-title/$task_id")

    # Get the GitHub repository and organization name from the Git remote URL
    remote_url=$(git config --get remote.origin.url)
    repo_name=$(basename -s .git $remote_url)
    org_name=$(basename $(dirname $remote_url))

    # PR Title
    pr_title="## $author_name | Task #$task_id - $task_title"
    echo "$pr_title"
    echo ""

    echo "#### PR Description:"
    echo ""
    echo "Please go view [Task #$task_id](https://icrewsystems.com/portal/index.php/tasks/view/$task_id) on the portal to understand about the exact requirements of this task"
    echo ""
    echo "**JAM Video Link:** $jam_link"
    echo ""

    # Checklist
    echo "## PR Checklist:"
    echo "### I, $author_name have verified to the best of my abilities that:"
    for status in "${checklist_status[@]}"; do
        echo "$status"
    done

    # Files changed
    echo "### Files changed in this PR:"
    for file in $changed_files; do
        echo " - $file"
    done
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

    # PHP Insights section
    echo "### PHP Insights Output:"
    echo "\`\`\`" # Start of code block in markdown
    insights_output=$(php artisan insights -s)
    echo "$insights_output"
    echo "\`\`\`" # End of code block

    if [ "$create_pr" = true ]; then
        # Open the GitHub PR creation URL
        github_url="https://github.com/$org_name/$repo_name/pull/new/$branch_name"

        # Detect OS and use the appropriate command to open the URL
        if [[ "$OSTYPE" == "darwin"* ]]; then
            open "$github_url"  # macOS
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            xdg-open "$github_url"  # Linux
        elif [[ "$OSTYPE" == "cygwin" || "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
            start "$github_url"  # Windows
        else
            echo "Please manually open the following URL in your browser: $github_url"
        fi
    fi

else
    echo "Whoops! The current branch name doesn't match the format specified by icrewsystems."
fi
