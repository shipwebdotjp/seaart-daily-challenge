# seaart-daily-challenge

## Disclaimer
Use at your own risk.

## Description
Automatically posts your daily [seaart.ai](https://www.seaart.ai) challenge.
1. Automatically fetches the theme
2. Creates a prompt for that theme
3. Generates an image and posts it
It does all of this automatically.

## Prerequisites
- macOS
- Google Chrome installed
- For the first time, manually log in to seaart.ai

## Table of Contents
- [Installation](#installation)
- [Usage](#usage)
- [Development](#development)
- [Tests](#tests)
- [Contributing](#contributing)
- [License](#license)

## Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/shipwebdotjp/seaart-daily-challenge.git
cd seaart-daily-challenge
npm install
```

## Usage
Open Chrome with remote debugging enabled to allow Puppeteer to connect:
```bash
# macOS example
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="/tmp/<USERNAME>/chrome"
```
Run the challenge script:
```bash
npm start
```

## Development
Project structure:
- `src/` - source code files
- `tests/` - test suite files

## Tests
Run tests with:
```bash
npm test
```

## Contributing
Contributions are welcome! Please open issues or submit pull requests for improvements.

## License
This project is licensed under the ISC License. See the `LICENSE` file for details.
