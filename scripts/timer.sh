#!/bin/bash

# Define the path to auth-code.txt
auth_file="scripts/auth-code.txt"

# Check if auth-code.txt exists
if [[ ! -f "$auth_file" ]]; then
    echo "Error: auth-code.txt not found in the scripts folder."
    echo "To use this timer.sh script, please create an auth-code.txt file in the scripts folder."
    echo "Add your private auth code to the file and make sure auth-code.txt is included in .gitignore."
    exit 1
fi

# Read the token from auth-code.txt
token=$(<"$auth_file")

# Get the current Git branch name
branch_name=$(git rev-parse --abbrev-ref HEAD)

# Define protected branches
protected_branches=("master" "production" "staging")

# Check if the developer is on a protected branch
for protected_branch in "${protected_branches[@]}"; do
    if [[ "$branch_name" == "$protected_branch" ]]; then
        echo "Error: You are on the $branch_name branch. Timer commands are not allowed on protected branches."
        exit 1
    fi
done

# Extract task ID from branch name (expects format: nameofthedev_task_taskID)
if [[ "$branch_name" =~ [a-zA-Z]+_task_([0-9]+) ]]; then
    task_id="${BASH_REMATCH[1]}"
else
    echo "Error: Branch name does not contain a task ID in the expected format 'nameofthedev_task_taskID'. Aborting."
    exit 1
fi

# Check if the user wants to start or stop the timer
read -p "Do you want to start or stop the timer? (start/stop): " action

# Set the API URL based on action
if [[ "$action" == "start" ]]; then
    api_url="https://cerebro.icrewsystems.com/api/v1/start-timer/$task_id?token=$token"
elif [[ "$action" == "stop" ]]; then
    # Prompt for notes if stopping the timer
    read -p "Enter notes for this timer stop: " notes
    # URL-encode notes by replacing spaces with dashes
    notes_encoded=$(echo "$notes" | sed 's/ /-/g')
    api_url="https://cerebro.icrewsystems.com/api/v1/stop-timer/$task_id/$notes_encoded?token=$token"
else
    echo "Invalid action. Please enter 'start' or 'stop'."
    exit 1
fi

# Send the request and capture the response
response=$(curl -s -X GET "$api_url")

# Check if response contains "Invalid token"
if echo "$response" | grep -q "Invalid token"; then
    echo "Error: Invalid token provided. Please check your auth-code.txt and try again."
    exit 1
else
    echo "Response from server: $response"
    if [[ "$action" == "start" ]]; then
        echo "Timer started for Task ID $task_id"
    else
        echo "Timer stopped for Task ID $task_id with notes: $notes"
    fi
fi
