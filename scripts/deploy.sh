#!/bin/bash

echo "Deploying App to production"

REMOTE_COMMANDS="
cd /home/ploi/flyairnordic.com
git pull origin master
echo 'Pulled latest from Github'
composer install --no-interaction --prefer-dist --optimize-autoloader
service php8.1-fpm reload
php artisan route:cache
php artisan view:clear
php artisan migrate --force
"

ssh ploi@159.223.9.35 -p 22 -i /Users/icrewsystemshq/.ssh/id_rsa_ceo_macbook "$REMOTE_COMMANDS"

if [ $? -eq 0 ]; then
    echo "🚀 Application deployed!"
else
    echo "❌ Deployment failed!"
    exit 1
fi
