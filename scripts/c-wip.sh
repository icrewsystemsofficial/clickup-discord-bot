#!/bin/bash

# Function to get current branch name
current_branch=$(git rev-parse --abbrev-ref HEAD)


# Check if there are changes to commit
if [[ -z $(git status --porcelain) ]]; then
    echo "No changes to commit."
    exit 0
fi

# Check if current branch is master, production, or staging
if [[ "$current_branch" == "master" || "$current_branch" == "production" || "$current_branch" == "staging" ]]; then
    read -p "You are on the $current_branch branch. Are you sure you want to continue? (y/n): " confirm
    if [[ "$confirm" != "y" ]]; then
        echo "Aborting commit."
        exit 1
    else
        echo "Note: This script is intended for WIP (Work-In-Progress) commit messages only."
        read -p "Enter a custom commit message: " custom_message
        if [[ -z "$custom_message" ]]; then
            echo "Custom commit message cannot be empty. Aborting."
            exit 1
        fi
        # Check for changes
        if [[ -z $(git status --porcelain) ]]; then
            echo "No changes to commit."
            exit 0
        fi
        git add .
        git commit -m "$custom_message"
        echo "Changes committed with custom message: $custom_message"
        exit 0
    fi
fi

# Extract task ID from branch name
# Branch name format: nameofthedev_task_taskID
if [[ "$current_branch" =~ [a-zA-Z]+_task_([0-9]+) ]]; then
    task_id="${BASH_REMATCH[1]}"
else
    echo "Error: Branch name does not contain a task ID in the expected format 'nameofthedev_task_taskID'. Aborting."
    exit 1
fi


# Generate timestamp
timestamp=$(date +"%Y-%m-%d %H:%M:%S")

# Commit message format
commit_message="[Task #${task_id}] Checkpoint, saving changes - Work In Progress - ${timestamp}"

# Perform the Git add and commit
git add .
git commit -m "$commit_message"

echo "Changes committed with message: $commit_message"