import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { buildAlphaContext } from '@/lib/alpha-context';

export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function clean(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const token = String(body?.token ?? '').trim();
    const question = String(body?.question ?? '').trim();

    if (!token) {
      return NextResponse.json(
        {
          error: 'Enter a token contract address.',
        },
        {
          status: 400,
        }
      );
    }

    if (!question) {
      return NextResponse.json(
        {
          error: 'Ask AlphaOS a question.',
        },
        {
          status: 400,
        }
      );
    }

    const context = await buildAlphaContext(token);

    if (!context) {
      return NextResponse.json(
        {
          error:
            'This contract is not currently available in Alpha Memory.',
        },
        {
          status: 404,
        }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error:
            'AlphaOS AI is not configured on this environment.',
        },
        {
          status: 500,
        }
      );
    }

    const response = await openai.responses.create({
      model: 'gpt-5.5',

      instructions: `
You are AlphaOS, an evidence-based crypto research analyst.

You investigate token data supplied by AlphaOS.

RULES:

1. Answer the user's exact question.
2. Use only facts present in ALPHAOS_CONTEXT.
3. Never invent wallet activity, creator history, holder data, targets, probabilities, prices, or outcomes.
4. Clearly say when a signal is unavailable or still collecting data.
5. Distinguish historical correlation from certainty.
6. Never guarantee profit or describe a token as risk-free.
7. Be decisive when evidence supports a view.
8. When discussing an entry, explain what conditions support entering now versus waiting.
9. When discussing holding, explain the current evidence and what would invalidate the thesis.
10. When discussing risk, prioritize drawdown, current flow, historical learning, creator evidence, and live outcomes.
11. Do not tell the user that you are ChatGPT or OpenAI.
12. Call yourself AlphaOS.
13. Keep the answer practical and trader-focused.
14. Do not repeat the entire dataset.
15. Use short sections where helpful.

Preferred style:

VERDICT
One direct sentence.

WHY
The strongest evidence.

RISK
The key invalidation or missing evidence.

PLAN
A practical research-based approach.

Never claim certainty.
`.trim(),

      input: `
USER QUESTION:

${question}

ALPHAOS_CONTEXT:

${clean(context)}
`.trim(),
    });

    const answer =
      response.output_text?.trim() ||
      'AlphaOS could not produce an analysis for this token.';

    return NextResponse.json({
      token,
      answer,
      context: {
        symbol: context.identity.symbol,
        score: context.decision.adjustedScore,
        action: context.decision.action,
        learningAdjustment:
          context.decision.learningAdjustment,
        riskLevel: context.decision.riskLevel,
      },
    });
  } catch (error) {
    console.error('AlphaOS analysis error:', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'AlphaOS investigation failed.',
      },
      {
        status: 500,
      }
    );
  }
}