import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { getResilientReasoningQuestions } from "./server/reasoningFallback.js";
import { liveTestStore } from "./server/liveTestManager.js";

let aiClient: GoogleGenAI | null = null;
let quotaExhaustedUntil = 0;

// Set model targets
const PRIMARY_MODEL = "gemini-1.5-flash";
const FALLBACK_MODELS = ["gemini-1.5-flash-8b"];

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isQuotaOrRateLimitError(err: any): boolean {
  if (!err) return false;
  const status = err.status || err.code || err.error?.code;
  const msg = (err.message || err.error?.message || "").toLowerCase();
  return (
    status === 429 ||
    status === "RESOURCE_EXHAUSTED" ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted") ||
    msg.includes("exceeded your current quota")
  );
}

// Retries primary model (gemini-1.5-flash) and falls back to backup models on quota errors
async function generateWithRetry(ai: GoogleGenAI, params: any, maxRetries = 2): Promise<any> {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[DEBUG] Attempting generation with model: ${modelName} (Attempt ${attempt})`);
        return await ai.models.generateContent({ ...params, model: modelName });
      } catch (err: any) {
        const errStr = (err?.message || err?.error?.message || "").toLowerCase();
        const is429 = isQuotaOrRateLimitError(err);
        const is503 = err?.status === 503 || errStr.includes("503") || errStr.includes("high demand");

        if ((is429 || is503) && attempt < maxRetries) {
          console.warn(`[WARN] Model ${modelName} rate limited. Retrying attempt ${attempt + 1}/${maxRetries}...`);
          await sleep(2000);
        } else if (is429 || is503) {
          console.warn(`[WARN] Quota exhausted on ${modelName}. Cascading to fallback model...`);
          break; // Switch to the next available model
        } else {
          throw err;
        }
      }
    }
  }
  throw new Error("All AI models failed or exceeded quota limits.");
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/api/generate-pdf-reasoning-questions", async (req, res) => {
    const { pdfBase64, count = 50, timestamp = Date.now(), seed = Math.random().toString() } = req.body;
    const requestedTotal = Math.min(Math.max(Number(count) || 10, 5), 100);

    console.log(`[DEBUG] Received PDF payload base64 length: ${pdfBase64 ? pdfBase64.length : 0}`);

    try {
      if (!process.env.GEMINI_API_KEY) {
        console.warn("[WARN] GEMINI_API_KEY missing. Serving fallback bank.");
        const fallbackQs = getResilientReasoningQuestions(requestedTotal);
        return res.json({ success: true, questions: fallbackQs, isFallback: true });
      }

      if (Date.now() < quotaExhaustedUntil) {
        const remainingMs = Math.ceil((quotaExhaustedUntil - Date.now()) / 1000);
        console.warn(`[WARN] Quota cooling down for ${remainingMs}s. Serving fallback bank.`);
        const fallbackQs = getResilientReasoningQuestions(requestedTotal);
        return res.json({ success: true, questions: fallbackQs, isFallback: true });
      }

      const ai = getAIClient();

      const basePdfParts: any[] = [];
      if (pdfBase64 && typeof pdfBase64 === "string" && pdfBase64.length > 50) {
        const cleanBase64 = pdfBase64.includes(",") 
          ? pdfBase64.split(",")[1] 
          : pdfBase64;

        basePdfParts.push({
          inlineData: {
            mimeType: "application/pdf",
            data: cleanBase64.trim()
          }
        });
      } else {
        console.warn("[WARN] Invalid or empty PDF base64 provided in payload.");
      }

      const batchSize = requestedTotal <= 25 ? requestedTotal : 25;
      const totalBatches = Math.ceil(requestedTotal / batchSize);
      const batchCounts: number[] = [];
      let rem = requestedTotal;
      for (let i = 0; i < totalBatches; i++) {
        const c = Math.min(rem, batchSize);
        batchCounts.push(c);
        rem -= c;
      }

      const generateBatch = async (bCount: number, batchIdx: number): Promise<any[]> => {
        if (Date.now() < quotaExhaustedUntil) {
          console.warn(`[WARN] Quota exhausted. Skipping API call for batch ${batchIdx + 1} and using fallback.`);
          return getResilientReasoningQuestions(bCount);
        }

        const randomEntropyKey = `SESSION_${timestamp}_VARIATION_${seed}_BATCH_${batchIdx + 1}_RND_${Math.floor(Math.random() * 1000000)}`;

        const instructions = `You are a Master Professor of Formal Logic, Analytical Aptitude, and NIELIT 'O' Level Examination Question Setter.
Carefully read and comprehend every premise, rule, definition, classification, and logical relationship in the provided study notes.

Task:
Synthesize exactly ${bCount} authentic, NIELIT 'O' Level difficulty Multiple Choice Questions (MCQs) (Batch ${batchIdx + 1} of ${totalBatches}) directly based on or inspired by the logical concepts, arguments, problems, and structures in the attached notes.

Generation Entropy Token: ${randomEntropyKey}

MANDATORY DIVERSITY & VARIATION RULES:
1. Produce a fresh, distinct set of logical reasoning questions adhering strictly to NIELIT O Level syllabus.
2. BILINGUAL PRESENTATION:
   - questionEn: Clear question text in English.
   - questionHi: Professional Hindi translation of the question.
   - optionsEn: Array of EXACTLY 4 distinct English options [A, B, C, D].
   - optionsHi: Array of EXACTLY 4 corresponding Hindi options [A, B, C, D].
3. 4 OPTIONS & STRICTLY VALIDATED KEY:
   - Exactly 4 options.
   - correctIndex: Integer 0, 1, 2, or 3 pointing strictly to the single valid option.
4. STEP-BY-STEP LOGIC EXPLANATION:
   - explanationEn: Step-by-step walkthrough in English.
   - explanationHi: Detailed explanation in Hindi.
5. TOPIC & DIFFICULTY:
   - topic: Logical reasoning subfield.
   - difficulty: "O Level Difficulty"

Return ONLY a JSON array adhering strictly to the schema.`;

        const contentsParts = [...basePdfParts, { text: instructions }];
        let resp: any = null;

        try {
          resp = await generateWithRetry(ai, {
            contents: { parts: contentsParts },
            config: {
              temperature: 0.8,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    questionEn: { type: Type.STRING },
                    questionHi: { type: Type.STRING },
                    optionsEn: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    optionsHi: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    correctIndex: { type: Type.INTEGER },
                    explanationEn: { type: Type.STRING },
                    explanationHi: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    difficulty: { type: Type.STRING }
                  },
                  required: ["questionEn", "optionsEn", "correctIndex", "explanationEn", "optionsHi", "questionHi"]
                }
              }
            }
          });
        } catch (err: any) {
          console.error(`[ERROR] Gemini generation failed for batch ${batchIdx + 1}:`, err?.message || err);
          if (isQuotaOrRateLimitError(err)) {
            quotaExhaustedUntil = Date.now() + 60 * 1000;
            console.warn(`[WARN] Quota cooldown set until ${new Date(quotaExhaustedUntil).toLocaleTimeString()}`);
          }
          return getResilientReasoningQuestions(bCount);
        }

        if (!resp || !resp.text) {
          console.warn(`[WARN] Empty response from Gemini for batch ${batchIdx + 1}. Serving fallback.`);
          return getResilientReasoningQuestions(bCount);
        }

        try {
          const parsed = JSON.parse(resp.text || "[]");
          return Array.isArray(parsed) && parsed.length > 0 ? parsed : getResilientReasoningQuestions(bCount);
        } catch {
          return getResilientReasoningQuestions(bCount);
        }
      };

      const allResults: any[] = [];
      for (let i = 0; i < batchCounts.length; i++) {
        if (i > 0) {
          if (Date.now() < quotaExhaustedUntil) {
            console.log(`[INFO] Quota active. Immediately serving fallback for remaining batch ${i + 1}`);
            allResults.push(...getResilientReasoningQuestions(batchCounts[i]));
            continue;
          }
          console.log(`[INFO] Pacing request... waiting 2s before requesting batch ${i + 1}`);
          await sleep(2000);
        }
        const batchQuestions = await generateBatch(batchCounts[i], i);
        allResults.push(...batchQuestions);
      }

      if (allResults.length < requestedTotal) {
        const needed = requestedTotal - allResults.length;
        const fillQs = getResilientReasoningQuestions(needed);
        allResults.push(...fillQs);
      }

      return res.json({ success: true, questions: allResults });
    } catch (error: any) {
      console.error("Error generating reasoning questions from PDF:", error);
      const fallbackQs = getResilientReasoningQuestions(requestedTotal);
      return res.json({
        success: true,
        questions: fallbackQs,
        isFallback: true,
        notice: "Served high-yield NIELIT O-Level logical reasoning questions."
      });
    }
  });

  app.post("/api/generate-ai-questions", async (req, res) => {
    try {
      const { moduleCode, moduleTitle, chapterName, count = 5, topic } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error: "GEMINI_API_KEY is not configured in environment.",
          fallbackAvailable: true
        });
      }

      if (Date.now() < quotaExhaustedUntil) {
        return res.status(429).json({
          error: "API quota active. Please try again shortly.",
          fallbackAvailable: true
        });
      }

      const ai = getAIClient();
      const prompt = `You are a Senior Question Paper Setter for NIELIT for 'O Level' (Revision 5.1).
Generate ${count} authentic MCQs for:
Module: ${moduleCode} - ${moduleTitle}
Chapter/Topic: ${chapterName} ${topic ? `(Focus: ${topic})` : ''}

Strict Requirements:
1. Each question must have:
   - questionEn: English question text
   - questionHi: Hindi translation
   - optionsEn: Array of 4 English options [A, B, C, D]
   - optionsHi: Array of 4 Hindi options [A, B, C, D]
   - correctIndex: 0, 1, 2, or 3
   - explanationEn: Detailed English explanation
   - explanationHi: Detailed Hindi explanation
   - difficulty: "easy", "medium", or "hard"
2. Questions must adhere strictly to NIELIT O Level R5.1 curriculum. Return valid JSON adhering to the schema.`;

      const response = await generateWithRetry(ai, {
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                questionEn: { type: Type.STRING },
                questionHi: { type: Type.STRING },
                optionsEn: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                optionsHi: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctIndex: { type: Type.INTEGER },
                explanationEn: { type: Type.STRING },
                explanationHi: { type: Type.STRING },
                difficulty: { type: Type.STRING, enum: ["easy", "medium", "hard"] }
              },
              required: ["questionEn", "optionsEn", "correctIndex", "explanationEn"]
            }
          }
        }
      });

      const parsed = JSON.parse(response.text || "[]");
      return res.json({ success: true, questions: parsed });
    } catch (error: any) {
      console.error("Error generating AI questions:", error);
      if (isQuotaOrRateLimitError(error)) {
        quotaExhaustedUntil = Date.now() + 60 * 1000;
      }
      return res.status(500).json({ error: error.message || "Failed to generate questions" });
    }
  });

  // ==========================================
  // HOST & JOIN LIVE TEST SESSION ENDPOINTS
  // ==========================================

  app.post("/api/live-tests/create", (req, res) => {
    try {
      const {
        hostName,
        title,
        subOptionTitle,
        mode,
        durationMinutes,
        questionCount,
        config,
        questions,
        passcode,
        allowLateJoiners,
        showImmediateResults,
        negativeMarking
      } = req.body;

      let validQuestions = questions;
      if (!validQuestions || !Array.isArray(validQuestions) || validQuestions.length === 0) {
        const qCount = Math.max(10, Math.min(Number(questionCount) || 50, 100));
        validQuestions = getResilientReasoningQuestions(qCount).map((q, idx) => ({
          id: `LIVE-Q-${Date.now()}-${idx + 1}`,
          moduleId: 'M1',
          chapterNumber: (idx % 9) + 1,
          chapterName: q.topic || 'General Computing & Reasoning',
          questionEn: q.questionEn,
          questionHi: q.questionHi,
          optionsEn: q.optionsEn,
          optionsHi: q.optionsHi,
          correctIndex: q.correctIndex,
          explanationEn: q.explanationEn,
          explanationHi: q.explanationHi,
          source: 'ai_generated',
          sourceLabel: 'NIELIT Master Question Bank'
        }));
      }

      const { session, hostToken } = liveTestStore.createSession({
        hostName: hostName || "Examiner",
        title: title || "NIELIT O Level Live Examination",
        subOptionTitle,
        mode: mode === "pdf_notes" ? "pdf_notes" : "exam_generator",
        durationMinutes: Number(durationMinutes) || 90,
        questionCount: validQuestions.length,
        config: config || {},
        passcode,
        allowLateJoiners,
        showImmediateResults,
        negativeMarking,
        questions: validQuestions
      });

      return res.json({
        success: true,
        testId: session.testId,
        hostToken,
        session: {
          testId: session.testId,
          title: session.title,
          subOptionTitle: session.subOptionTitle,
          mode: session.mode,
          status: session.status,
          durationMinutes: session.durationMinutes,
          questionCount: session.questionCount,
          hostName: session.hostName,
          createdAt: session.createdAt,
          passcode: session.passcode,
          allowLateJoiners: session.allowLateJoiners,
          showImmediateResults: session.showImmediateResults,
          negativeMarking: session.negativeMarking,
          students: session.students
        }
      });
    } catch (err: any) {
      console.error("Failed to create live test session:", err);
      return res.status(500).json({ error: err.message || "Could not create live test server." });
    }
  });

  app.post("/api/live-tests/:testId/join", (req, res) => {
    try {
      const { testId } = req.params;
      const { studentName, rollNumber, passcode } = req.body;

      if (!studentName || !studentName.trim()) {
        return res.status(400).json({ error: "Please enter your full name." });
      }
      if (!rollNumber || !rollNumber.trim()) {
        return res.status(400).json({ error: "Please enter your roll number." });
      }

      const result = liveTestStore.joinStudent(testId, studentName, rollNumber, passcode);
      if ("error" in result) {
        return res.status(404).json({ error: result.error });
      }

      return res.json({
        success: true,
        student: result.student,
        session: {
          testId: result.session.testId,
          title: result.session.title,
          subOptionTitle: result.session.subOptionTitle,
          mode: result.session.mode,
          status: result.session.status,
          startedAt: result.session.startedAt,
          durationMinutes: result.session.durationMinutes,
          questionCount: result.session.questionCount,
          hostName: result.session.hostName,
          broadcastMessage: result.session.broadcastMessage,
          broadcastTime: result.session.broadcastTime,
          showImmediateResults: result.session.showImmediateResults,
          negativeMarking: result.session.negativeMarking,
          questions: result.session.status === "in_progress" ? result.session.questions : []
        }
      });
    } catch (err: any) {
      console.error("Error joining live test:", err);
      return res.status(500).json({ error: err.message || "Could not join test session." });
    }
  });

  app.get("/api/live-tests/:testId/session", (req, res) => {
    try {
      const { testId } = req.params;
      const { hostToken, studentId } = req.query;

      const session = liveTestStore.getSession(testId);
      if (!session) {
        return res.status(404).json({ error: "Session not found." });
      }

      const isHost = hostToken && session.hostToken === hostToken;

      if (isHost) {
        return res.json({
          success: true,
          isHost: true,
          session: {
            testId: session.testId,
            title: session.title,
            subOptionTitle: session.subOptionTitle,
            mode: session.mode,
            status: session.status,
            createdAt: session.createdAt,
            startedAt: session.startedAt,
            durationMinutes: session.durationMinutes,
            questionCount: session.questionCount,
            hostName: session.hostName,
            passcode: session.passcode,
            allowLateJoiners: session.allowLateJoiners,
            showImmediateResults: session.showImmediateResults,
            negativeMarking: session.negativeMarking,
            broadcastMessage: session.broadcastMessage,
            broadcastTime: session.broadcastTime,
            proctoringAlerts: session.proctoringAlerts || [],
            students: Object.values(session.students),
            questionsCount: session.questions.length,
            questions: session.questions
          }
        });
      }

      const student = studentId ? session.students[String(studentId)] : null;
      const studentSummaryList = Object.values(session.students).map(s => ({
        id: s.id,
        studentName: s.studentName,
        rollNumber: s.rollNumber,
        status: s.status,
        joinedAt: s.joinedAt
      }));

      return res.json({
        success: true,
        isHost: false,
        session: {
          testId: session.testId,
          title: session.title,
          subOptionTitle: session.subOptionTitle,
          mode: session.mode,
          status: session.status,
          startedAt: session.startedAt,
          durationMinutes: session.durationMinutes,
          questionCount: session.questionCount,
          hostName: session.hostName,
          broadcastMessage: session.broadcastMessage,
          broadcastTime: session.broadcastTime,
          showImmediateResults: session.showImmediateResults,
          negativeMarking: session.negativeMarking,
          students: studentSummaryList,
          myStudentStatus: student ? student.status : null,
          questions: session.status === "in_progress" || session.status === "ended" ? session.questions : []
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to fetch session." });
    }
  });

  app.post("/api/live-tests/:testId/start", (req, res) => {
    try {
      const { testId } = req.params;
      const { hostToken } = req.body;

      const result = liveTestStore.startTest(testId, hostToken);
      if (!result.success) {
        return res.status(403).json({ error: result.error || "Cannot start test." });
      }

      return res.json({
        success: true,
        status: "in_progress",
        startedAt: result.session?.startedAt
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to start test." });
    }
  });

  app.post("/api/live-tests/:testId/progress", (req, res) => {
    try {
      const { testId } = req.params;
      const { studentId, answersCount, userAnswers, tabSwitchesCount } = req.body;

      const ok = liveTestStore.updateStudentProgress(
        testId,
        studentId,
        Number(answersCount) || 0,
        userAnswers,
        typeof tabSwitchesCount === "number" ? tabSwitchesCount : undefined
      );
      return res.json({ success: ok });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/live-tests/:testId/submit", (req, res) => {
    try {
      const { testId } = req.params;
      const { studentId, score, maxScore, percentage, userAnswers } = req.body;

      const ok = liveTestStore.submitStudentTest(
        testId,
        studentId,
        Number(score) || 0,
        Number(maxScore) || 100,
        Number(percentage) || 0,
        userAnswers || {}
      );
      return res.json({ success: ok });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/live-tests/:testId/proctor-event", (req, res) => {
    try {
      const { testId } = req.params;
      const {
        studentId,
        eventType,
        tabSwitchesCount,
        isAutoSubmitted,
        score,
        maxScore,
        percentage,
        userAnswers
      } = req.body;

      const result = liveTestStore.recordProctoringEvent(
        testId,
        studentId,
        eventType,
        {
          tabSwitchesCount: typeof tabSwitchesCount === 'number' ? tabSwitchesCount : undefined,
          isAutoSubmitted: Boolean(isAutoSubmitted),
          score: typeof score === 'number' ? score : undefined,
          percentage: typeof percentage === 'number' ? percentage : undefined,
          userAnswers
        }
      );
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/live-tests/:testId/end", (req, res) => {
    try {
      const { testId } = req.params;
      const { hostToken } = req.body;

      const result = liveTestStore.endTest(testId, hostToken);
      if (!result.success) {
        return res.status(403).json({ error: result.error || "Cannot end test." });
      }
      return res.json({ success: true, status: "ended" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/live-tests/:testId/kick", (req, res) => {
    try {
      const { testId } = req.params;
      const { hostToken, studentId } = req.body;

      const ok = liveTestStore.kickStudent(testId, hostToken, studentId);
      return res.json({ success: ok });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/live-tests/:testId/broadcast", (req, res) => {
    try {
      const { testId } = req.params;
      const { hostToken, message } = req.body;

      const ok = liveTestStore.setBroadcastMessage(testId, hostToken, String(message || ""));
      return res.json({ success: ok });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/live-tests/:testId/settings", (req, res) => {
    try {
      const { testId } = req.params;
      const { hostToken, showImmediateResults, allowLateJoiners } = req.body;

      const ok = liveTestStore.updateSessionSettings(testId, hostToken, {
        showImmediateResults: typeof showImmediateResults === "boolean" ? showImmediateResults : undefined,
        allowLateJoiners: typeof allowLateJoiners === "boolean" ? allowLateJoiners : undefined
      });
      return res.json({ success: ok });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/live-tests/:testId", (req, res) => {
    try {
      const { testId } = req.params;
      const { hostToken } = req.body;

      const ok = liveTestStore.deleteSession(testId, hostToken);
      return res.json({ success: ok });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();