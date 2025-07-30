#!/bin/bash

echo "🚀 Setting up Research Engine MCP Server..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📄 Creating .env file from template..."
    cp .env.example .env
    echo "✅ Created .env file - please update with your configuration"
else
    echo "✅ .env file already exists"
fi

# Run validation
echo ""
echo "🔍 Validating configuration..."
npm run validate

# Build TypeScript
echo ""
echo "🔨 Building TypeScript..."
npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update .env with your Research API credentials"
echo "2. Run 'npm run dev' to start the development server"
echo "3. Test with: curl -X POST http://localhost:3000/mcp/tools/research_brief -H \"Content-Type: application/json\" -d '{\"brief\": \"Test research\"}'"
echo ""
echo "For deployment:"
echo "- Update mcp.yaml with your deployment URL"
echo "- Deploy to Railway, Heroku, or your preferred platform"
echo ""