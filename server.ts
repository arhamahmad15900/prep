import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { getResilientReasoningQuestions } from "./server/reasoningFallback.js";
import { liveTestStore } from "./server/liveTestManager.js";

let aiClient: GoogleGenAI | null = null;
let quotaExhaustedUntil = 0;

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // 1. Increased body payload limits to 50MB for large PDF files
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Multimodal Gemini AI Endpoint: Read PDF notes and generate Logical Reasoning MCQs
  app.post("/api/generate-pdf-reasoning-questions", async (req, res) => {
    const { pdfBase64, count = 50, timestamp = Date.now(), seed = Math.random().toString() } = req.body;
    const requestedTotal = Math.min(Math.max(Number(count) || 10, 5), 100);

    // 2. Debug payload length
    console.log(`[DEBUG] Received PDF payload base64 length: ${pdfBase64 ? pdfBase64.length : 0}`);

    try {
      // If Gemini key is missing or quota was recently exhausted, serve resilient reasoning MCQs instantly
      if (!process.env.GEMINI_API_KEY || Date.now() < quotaExhaustedUntil) {
        console.warn("[WARN] GEMINI_API_KEY missing or quota cooling down. Using fallback bank.");
        const fallbackQs = getResilientReasoningQuestions(requestedTotal);
        return res.json({ success: true, questions: fallbackQs, isFallback: true });
      }

      const ai = getAIClient();

      const basePdfParts: any[] = [];
      if (pdfBase64 && typeof pdfBase64 === "string" && pdfBase64.length > 50) {
        const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
        basePdfParts.push({
          inlineData: {
            mimeType: "application/pdf",
            data: cleanBase64
          }
        });
      } else {
        console.warn("[WARN] No valid PDF base64 payload provided in request.");
      }

      // Fast, manageable batch size of 15 Qs per batch
      const batchSize = requestedTotal <= 15 ? requestedTotal : 15;
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
        
        // Active production Gemini Flash model
        const modelsToTry = ["gemini-3.6-flash"];
        let resp: any = null;

        for (const modelName of modelsToTry) {
          try {
            console.log(`[DEBUG] Requesting batch ${batchIdx + 1} with model: ${modelName}`);
            resp = await ai.models.generateContent({
              model: modelName,
              contents: {
                parts: contentsParts
              },
              config: {
                temperature: 0.9,
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
            if (resp && resp.text) break;
          } catch (err: any) {
            console.error(`[ERROR] Gemini generation failed with model ${modelName}:`, err?.message || err);
            const errStr = (err?.message || "").toLowerCase();
            if (err?.status === "RESOURCE_EXHAUSTED" || errStr.includes("429") || errStr.includes("quota") || errStr.includes("rate")) {
              quotaExhaustedUntil = Date.now() + 5 * 60 * 1000;
              return getResilientReasoningQuestions(bCount);
            }
          }
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

      // Run batches with concurrency control (2 concurrent requests)
      const allResults: any[] = [];
      for (let i = 0; i < batchCounts.length; i += 2) {
        const slice = batchCounts.slice(i, i + 2);
        const batchPromises = slice.map((c, sIdx) => generateBatch(c, i + sIdx));
        try {
          const resolved = await Promise.all(batchPromises);
          resolved.forEach(arr => allResults.push(...arr));
        } catch {
          const sliceTotal = slice.reduce((a, b) => a + b, 0);
          allResults.push(...getResilientReasoningQuestions(sliceTotal));
        }
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

  // AI-powered NIELIT O-Level question generation endpoint
  app.post("/api/generate-ai-questions", async (req, res) => {
    try {
      const { moduleCode, moduleTitle, chapterName, count = 5, topic } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error: "GEMINI_API_KEY is not configured in environment.",
          fallbackAvailable: true
        });
      }

      const ai = getAIClient();
      const prompt = `You are a Senior Question Paper Setter for NIELIT (National Institute of Electronics and Information Technology) for the 'O Level' examination (Revision 5.1).
Generate ${count} authentic, exam-quality Multiple Choice Questions (MCQs) for:
Module: ${moduleCode} - ${moduleTitle}
Chapter/Topic: ${chapterName} ${topic ? `(Focus: ${topic})` : ''}

Strict Requirements:
1. Each question must have:
   - questionEn: English question text
   - questionHi: Hindi translation of the question
   - optionsEn: Array of 4 English options [A, B, C, D]
   - optionsHi: Array of 4 Hindi options [A, B, C, D]
   - correctIndex: 0, 1, 2, or 3 representing the index of the correct option
   - explanationEn: Detailed explanation in English citing standard facts
   - explanationHi: Detailed explanation in Hindi
   - difficulty: "easy", "medium", or "hard"
2. Questions must be strictly based on the official NIELIT O Level R5.1 curriculum (like Examjila and official NIELIT previous year papers).
3. Do NOT make trick questions with ambiguous answers. Return only valid JSON adhering to the schema.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
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
          maxScore: typeof maxScore === 'number' ? maxScore : undefined,
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

  // Vite middleware for development vs static build for production
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