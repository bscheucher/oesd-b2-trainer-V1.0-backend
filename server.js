// server.js
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// AI Service Initialization
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ÖSD B2 Aufgabenvarianten
const aufgabenVarianten = {
  A: {
    title: "Kind und Beruf",
    aussagen: [
      "Job und Kind geht nicht. Immer mehr Frauen leiden unter der Doppelbelastung und dem großen Druck.",
      "Ich bin für mehr Fortbildung und Berufskurse während der Babypause: Nur so bleibt man auf dem Laufenden.",
      "Für den Wiedereinstieg ins Berufsleben brauchen Mütter und Väter bessere Chancen und flexible Arbeitszeiten."
    ],
    punkte: [
      "Wie denken Sie über diese Äußerungen?",
      "Begründen Sie Ihre persönliche Meinung.",
      "Beschreiben Sie eigene Erfahrungen (oder Erfahrungen von Freunden) zum Thema.",
      "Wie ist die Situation von berufstätigen Eltern in Ihrem Land?"
    ]
  },
  B: {
    title: "Zusammenleben – ja oder nein?",
    schlagzeilen: [
      "Die traditionelle Familie verliert an Wert: Eine Umfrage unter jungen Leuten zeigt, dass viele nicht mehr heiraten möchten, sondern in einer offenen Beziehung leben wollen.",
      "Scheidungsrate steigt: Immer mehr verheiratete Paare trennen sich. Warum funktioniert das Modell Ehe nicht mehr?",
      "GLÜCKLICHE SINGLES: Junge Leute immer mehr auf dem Ego-Trip: Allein leben ist schöner und einfacher!"
    ],
    punkte: [
      "Wie denken Sie über diese Schlagzeilen?",
      "Begründen Sie Ihre persönliche Meinung.",
      "Beschreiben Sie eigene Erfahrungen (oder Erfahrungen von Freunden) zum Thema.",
      "Wie ist die Situation in Ihrem Land?"
    ]
  }
};

// System Message für AI
const SYSTEM_MESSAGE = `Du bist ein erfahrener Prüfer für das ÖSD Zertifikat B2 und bewertest Stellungnahmen nach den offiziellen ÖSD-Kriterien. Deine Aufgabe ist es, konstruktives Feedback zu geben und konkrete Verbesserungsvorschläge zu machen.

Bewertungskriterien:
- Kommunikative Angemessenheit (K): 0-2 Punkte
- Textaufbau/Textkohärenz (T): 0-3 Punkte  
- Lexik/Ausdruck (L): 0-5 Punkte
- Formale Richtigkeit (F): 0-5 Punkte

Antworte IMMER im folgenden JSON-Format:
{
  "bewertung": {
    "K": 0-2,
    "T": 0-3,
    "L": 0-5,
    "F": 0-5,
    "gesamt": 0-17
  },
  "feedback": {
    "positiv": ["Stärke 1", "Stärke 2"],
    "verbesserungen": ["Schwäche 1 mit Lösung", "Schwäche 2 mit Lösung"]
  },
  "korrekturen": [
    {
      "original": "fehlerhafter Text",
      "korrigiert": "korrigierter Text", 
      "erklaerung": "Grund der Korrektur"
    }
  ],
  "tipps": ["Tipp 1", "Tipp 2", "Tipp 3"]
}`;

// Helper Functions
function createUserPrompt(variante, userText, wortanzahl) {
  const aufgabe = aufgabenVarianten[variante];
  let aufgabenText = "";
  
  if (variante === 'A') {
    aufgabenText = `Thema: ${aufgabe.title}\n\nAussagen:\n${aufgabe.aussagen.map(a => `"${a}"`).join('\n')}`;
  } else {
    aufgabenText = `Thema: ${aufgabe.title}\n\nSchlagzeilen:\n${aufgabe.schlagzeilen.map(s => `"${s}"`).join('\n')}`;
  }
  
  return `Aufgabe: ${aufgabenText}

Zu behandelnde Punkte:
${aufgabe.punkte.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Schüler-Text:
"${userText}"

Wortanzahl: ${wortanzahl} (Ziel: ~120 Wörter)

Bewerte diese Stellungnahme nach den ÖSD B2-Kriterien und gib detailliertes Feedback mit konkreten Verbesserungsvorschlägen.`;
}

function parseAIResponse(responseText) {
  try {
    // Versuche JSON zu extrahieren
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Kein JSON gefunden');
  } catch (error) {
    console.error('Fehler beim Parsen der AI-Antwort:', error);
    // Fallback-Response
    return {
      bewertung: { K: 1, T: 2, L: 2, F: 2, gesamt: 7 },
      feedback: {
        positiv: ["Text wurde eingereicht"],
        verbesserungen: ["Bewertung konnte nicht vollständig verarbeitet werden"]
      },
      korrekturen: [],
      tipps: ["Versuchen Sie es erneut"]
    };
  }
}

// API Endpoints
app.get('/api/aufgaben', (req, res) => {
  res.json(aufgabenVarianten);
});

app.post('/api/bewerten', async (req, res) => {
  try {
    const { variante, text, aiService = 'openai' } = req.body;
    
    // Validierung
    if (!variante || !text || !['A', 'B'].includes(variante)) {
      return res.status(400).json({ 
        error: 'Ungültige Eingabe. Variante A oder B und Text erforderlich.' 
      });
    }
    
    const wortanzahl = text.trim().split(/\s+/).length;
    
    // Zu kurzer Text
    if (wortanzahl < 60) {
      return res.json({
        bewertung: { K: 0, T: 0, L: 0, F: 0, gesamt: 0 },
        feedback: {
          positiv: [],
          verbesserungen: [`Text ist zu kurz (${wortanzahl} Wörter). Mindestens 60 Wörter erforderlich.`]
        },
        korrekturen: [],
        tipps: ["Schreiben Sie etwa 120 Wörter", "Gehen Sie auf alle vier Punkte ein"]
      });
    }
    
    const userPrompt = createUserPrompt(variante, text, wortanzahl);
    let aiResponse;
    
    try {
      if (aiService === 'anthropic') {
        // Claude 3 Haiku
        const response = await anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 2000,
          messages: [
            { role: 'user', content: SYSTEM_MESSAGE + '\n\n' + userPrompt }
          ]
        });
        aiResponse = response.content[0].text;
      } else {
        // ChatGPT-4o mini (default)
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_MESSAGE },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 2000,
          temperature: 0.3
        });
        aiResponse = response.choices[0].message.content;
      }
      
      const bewertung = parseAIResponse(aiResponse);
      console.log("Berwertung:", bewertung)
      
      res.json({
        ...bewertung,
        meta: {
          wortanzahl,
          variante,
          aiService,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (aiError) {
      console.error('AI Service Fehler:', aiError);
      
      // Fallback zum anderen Service
      if (aiService === 'openai') {
        return res.status(500).json({ 
          error: 'OpenAI Service nicht verfügbar. Versuchen Sie es mit Claude.',
          fallback: 'anthropic'
        });
      } else {
        return res.status(500).json({ 
          error: 'Anthropic Service nicht verfügbar. Versuchen Sie es mit OpenAI.',
          fallback: 'openai'
        });
      }
    }
    
  } catch (error) {
    console.error('Server Fehler:', error);
    res.status(500).json({ 
      error: 'Interner Server Fehler. Bitte versuchen Sie es später erneut.' 
    });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    services: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
  console.log(`Health Check: http://localhost:${PORT}/health`);
});