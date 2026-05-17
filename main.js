const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const readline = require('readline');


    const port = process.env.Port || 7000;
    const dataFile = path.resolve(__dirname, 'training-data.json');
    const conversationMemory = [];
    const maxTrainingSampels = 1000;
    const maxTrainingData = 10000;
    const maxMemory = 100;

    let startTrainingData = [
        {input: "Hallo", output: "Hallo, wie kann ich dir behilflich sein?"},
        {input: "Wer bist du ?", output: "Ich bin ein Chatbot(KI)-Modell, dass dich gerne unterstützt."},
        {input: "Was kannst du ?", output: "Ich bin gerne da um zu helfen und  zu reden."},
    ];

    function safeJsonParse(text, fallback) {
        try{
            return JSON.parse(text);
        } catch(err) {
         return fallback;
        }
    }

    function loadTrainingData() {
        if (fs.existsSync(dataFile)) {
            const raw = fs.readFileSync(dataFile,'utf-8');
            const data = safeJsonParse(raw,null);
            if (Array.isArray(data) && data.length > 0 )
                startTrainingData = data;
        }
    }

    function saveTrainingData() {
        fs.writeFileSync(dataFile,JSON.stringify(startTrainingData,null,2), 'utf-8');
    }

    function addTrainingData(input,output) {
        const trimmedInput = input.trim();
        const trimmedOutput = output.trim();
        const existingIndex = startTrainingData.findIndex((pair) => normalizeText(pair.input) === normalizeText(trimmedOutput));
        if (existingIndex >= 0) {
            startTrainingData[existingIndex].output = trimmedOutput;
        } else{
            startTrainingData.push({input: trimmedInput, output: trimmedOutput});
        } if (startTrainingData.length > maxTrainingData) {
            startTrainingData.shift();
        }
        saveTrainingData();
        return {input: trimmedInput, output: trimmedOutput, sampleCount: startTrainingData.length};
    }

    function normalizeText(text) {
       if (!text) return '';
       return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g , '')
        .replace(/\s+/g, ' ');
    }

    function getSimilarity(a,b) {   
        if (!a || !b) return 0;
        const setA = new Set(normalizeText(a).split(' ').filter(Boolean));
        const setB = new Set(normalizeText(b).split(' ').filter(Boolean));
        if(setA.size === 0 || setB.size === 0) return 0;
        const commonTokens = new Set([...setA].filter(token => setB.has(token))).size;
        const score = commonTokens / Math.max(setA.size, setB.size);
        return isNaN(score) ? 0 :score;
    }

    function findBestAnswer(input) {
        let bestScore = 0;
        let bestMatch = null;

        for (const pair of startTrainingData) {
            const score = getSimilarity(input, pair.input);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = pair.output;
            }
            if (score === 1) break;
        }
        return bestMatch || `Es tut mir leid , bitte versuche es mit einer anderen Frage.Oder trainiere mich mit /train ${input} | Antwort.`;
    }

    function generateResponse(message) {
        if(!message || typeof message !== 'string') {
            return "Ungültige Eingabe";
        }

        const trimmedMessage = message.trim();
        if(!trimmedMessage) {
            return "Bitte gib einen Satz ein.";
        }

        const exactMatch = startTrainingData.find((pair) => normalizeText(pair.input) === normalizeText(trimmedMessage));
        if (exactMatch) {
            return exactMatch.output;
        }

        const similarityMatch = findBestAnswer(trimmedMessage);
        if (similarityMatch) {
            return similarityMatch;
        }

        return "Es tut mir leid , ich habe keine passende Antwort gefunden.Trainiere mich mit POST /train.";
    }

    function parseJsonBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk.toString();
            });
            req.on('end', () => {
                if (!body) return resolve(null);
                try {
                    resolve(JSON.parse(body));
                }catch(err) {
                    reject(new Error('Ungültiges JSON'));
                }
        });
        req.on('error', reject);
    });
}

loadTrainingData();


const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'Get' && pathname === '/health') {
        res.writeHead(200);
        return res.end(JSON.stringify({status: 'ok', trainingSamples: startTrainingData.length}));
    }


        if (req.method === 'POST' && pathname === '/train') {
            try {
                const body = await parseJsonBody(req);
                const input = body.input;
                const output = body.output;
                if (!input || !output || typeof input !== 'string' || typeof output !== 'string') {
                    throw new Error('Ungültige Eingabe, bitte gib sowohl input als auch output als Strings an.')
                }
                const trimmedInput = input.trim();
                const trimmedOutput = output.trim();
                const result = addTrainingData(trimmedInput, trimmedOutput);
                res.writeHead(200);
                return res.end(JSON.stringify({ status: 'successfully trained', sampleCount: result.sampleCount, example: {input: result.input, output: result.output} }));
            } catch (err) {
                res.writeHead(400);
                return res.end(JSON.stringify({ error: err.message}));
            }
        }

        if (req.method === 'GET' && pathname === '/conversations') {
            res.writeHead(200);
            return res.end(JSON.stringify({ memory: conversationMemory.slice()}));
        }

        res.writeHead(404);
        return res.end(JSON.stringify({error: 'Endpoint nicht gefunden'}));
});

const defaultPort = Number.parseInt(process.env.Port, 10) || 3000;
const maxPortRetries = 5;

function startServer(port, retriesLeft = maxPortRetries) {
    server.listen(port, () => {
        console.log('Server läuft auf Port' + port);
        console.log('POST /ask mit {input: "Deine Text"} um eine Antwort zu erhalten.');
        console.log('POST /train mit {input: "Frage", output: "Antwort"}');
    });

    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
            console.warn(`Port ${port} ist bereits in Verwendung.Versuche es mit Port ${port + 1}...`);
            startServer(port + 1, retriesLeft - 1);
            return;
        }
});
}

function startInteractiveMode() {
    const rl = readline.createInterface({input: process.stdin,
    output: process.stdout});
    rl.setPrompt('Du:');
rl.prompt();

console.log('Gib einen Text ein oder "exit" zum Beenden.');

rl.on('line', (line) => {
    const userInput = line.trim();
    if(!userInput) {
        rl.prompt();
        return;
    }


    if (userInput === 'exit' || userInput === 'quit') {
        console.log('Ich beende die Sitzung.Auf Wiedersehen!');
        rl.close();
        return;
    }

    if (userInput === '/help') {
        console.log('Befehle:');
        console.log('/help - Zeigt diese Hilfe an');
        console.log('/status - Zeigt den aktuellen Status des Chatbots an');
        console.log('/train - Trainiere den Chatbot mit einem neuen Beispiel (Format: /train Frage | Antwort) oder aktualisiere eine bestehende Antwort (Format: /train Frage | Neue Antwort)');
        console.log('/exit oder /quit - Beendet die Sitzung');
        rl.prompt();
        return;
    }

    if (userInput === '/status') {
        console.log(`Aktuelle Trainingsbeispiele: ${startTrainingData.length}`);
        console.log(`Gespeicherte Gespräche: ${conversationMemory.length}`);
        rl.prompt();
        return;
    }

    if (userInput.startsWith('/train ')) {
        const inputOutput = userInput.slice(7).split('|').map((part) => part.trim());
        if (inputOutput.length === 2 && inputOutput[0] && inputOutput[1]) {
            const[input, output] = inputOutput;
            const result = addTrainingData(input, output);
            console.log('Trainiert:', JSON.stringify({input: result.input, output: result.output}));
            console.log(`Trainingsdaten insgesamt: ${result.sampleCount}`);
        } else {
            console.log('Ungültiges Format. Bitte verwende: /train Frage | Antwort');
        }
        rl.prompt();
        return;
    }

    const response = generateResponse(userInput);
    conversationMemory.push({question: userInput, answer: response});
    if (conversationMemory.length > maxMemory) conversationMemory.shift();

    console.log('Du:', userInput);
    console.log('Bot:', response);
    rl.prompt();
});

rl.on('close', () => {
    console.log('Sitzung beendent.Auf Wiedersehen!');
    process.exit(0);
});
}

const args = process.argv.slice(2);
const isInteractiveShell = process.stdin.isTTY && process.stdout.isTTY;
const useServer = args.includes('--server');
const useClient = args.includes('--client') || (!useServer && isInteractiveShell);

if (useClient) {
    startInteractiveMode();
} else {
    startServer(defaultPort);
}