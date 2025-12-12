#!/bin/bash

echo "🚀 Setting up Smart Locker System - New Architecture"
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd adruino-backend
npm install

# Copy environment file
if [ ! -f .env ]; then
    echo "📋 Creating .env file from template..."
    cp env.example .env
    echo "⚠️  Please configure .env file with your Firebase and Twilio credentials"
else
    echo "✅ .env file already exists"
fi

# Check if serviceAccountKey.json exists
if [ ! -f serviceAccountKey.json ]; then
    echo "⚠️  serviceAccountKey.json not found. Please download it from Firebase Console"
    echo "   Go to Project Settings > Service Accounts > Generate new private key"
else
    echo "✅ Firebase service account key found"
fi

cd ..

echo ""
echo "🎉 Setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Configure .env file in adruino-backend/ with your credentials"
echo "2. Add your Firebase serviceAccountKey.json to adruino-backend/"
echo "3. Deploy firebase_rules.json to Firebase Console"
echo "4. Start the backend server: cd adruino-backend && npm start"
echo "5. Open shipper.html or receiver.html in your browser"
echo "6. Upload smart_locker.ino to your ESP32"
echo ""
echo "📚 For detailed instructions, see README_NEW_ARCHITECTURE.md"
























