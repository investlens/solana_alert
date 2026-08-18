type TestCandidate = {
  decision:
    'WATCH' |
    'TRACK_ONLY';

  source:
    string;

  marketCap:
    number | null;

  liquidity:
    number | null;

  sellImpact:
    number | null;

  top1:
    number | null;

  devHolding:
    number | null;

  roi:
    number;

  ageSeconds:
    number;
};


const MAX_MC =
  5_000;

const MAX_LIQUIDITY =
  5_000;

const MAX_SELL_IMPACT =
  0.20;

const MAX_TOP1 =
  10;

const MAX_DEV =
  10;

const BREAKOUT_ROI =
  40;

const MAX_AGE_SECONDS =
  6 * 60;


function evaluate(
  c: TestCandidate,
) {
  const reasons:
    string[] = [];


  if (
    c.decision !==
    'TRACK_ONLY'
  ) {
    reasons.push(
      'Not TRACK_ONLY',
    );
  }


  if (
    c.source !== 'PONS' &&
    c.source !== 'ONCHAIN'
  ) {
    reasons.push(
      'Wrong discovery source',
    );
  }


  if (
    c.marketCap == null ||
    c.marketCap <= 0 ||
    c.marketCap >= MAX_MC
  ) {
    reasons.push(
      'Initial MC failed',
    );
  }


  if (
    c.liquidity == null ||
    c.liquidity <= 0 ||
    c.liquidity >=
      MAX_LIQUIDITY
  ) {
    reasons.push(
      'Initial liquidity failed',
    );
  }


  if (
    c.sellImpact == null ||
    c.sellImpact >
      MAX_SELL_IMPACT
  ) {
    reasons.push(
      'Initial sell impact failed',
    );
  }


  if (
    c.top1 == null ||
    c.top1 >
      MAX_TOP1
  ) {
    reasons.push(
      'Initial Top1 failed',
    );
  }


  if (
    c.devHolding != null &&
    c.devHolding >
        MAX_DEV
    ) {
    reasons.push(
        'Initial dev holding failed',
    );
    }


  if (
    c.roi <
    BREAKOUT_ROI
  ) {
    reasons.push(
      'Momentum below +40%',
    );
  }


  if (
    c.ageSeconds >
    MAX_AGE_SECONDS
  ) {
    reasons.push(
      'Breakout too late',
    );
  }


  return {
    trigger:
      reasons.length === 0,

    reasons,
  };
}


const tests = [

    {
  name:
    'Unknown initial dev but valid breakout',

  candidate: {
    decision:
      'TRACK_ONLY',

    source:
      'ONCHAIN',

    marketCap:
      2534,

    liquidity:
      4419.49,

    sellImpact:
      0.118,

    top1:
      0,

    devHolding:
      null,

    roi:
      105.69,

    ageSeconds:
      60,
  },
},
  {
    name:
      'BROODZ-style 2m breakout',

    candidate: {
      decision:
        'TRACK_ONLY',

      source:
        'PONS',

      marketCap:
        3017,

      liquidity:
        2999.75,

      sellImpact:
        0.089486877,

      top1:
        6.2891,

      devHolding:
        0,

      roi:
        66.58,

      ageSeconds:
        120,
    },
  },

  {
    name:
      'Same token before breakout',

    candidate: {
      decision:
        'TRACK_ONLY',

      source:
        'PONS',

      marketCap:
        3017,

      liquidity:
        2999.75,

      sellImpact:
        0.089486877,

      top1:
        6.2891,

      devHolding:
        0,

      roi:
        -15.15,

      ageSeconds:
        60,
    },
  },

  {
    name:
      'Missing holder data',

    candidate: {
      decision:
        'TRACK_ONLY',

      source:
        'PONS',

      marketCap:
        2800,

      liquidity:
        2800,

      sellImpact:
        0.09,

      top1:
        null,

      devHolding:
        1,

      roi:
        80,

      ageSeconds:
        120,
    },
  },

  {
    name:
      'High dev holding',

    candidate: {
      decision:
        'TRACK_ONLY',

      source:
        'ONCHAIN',

      marketCap:
        3000,

      liquidity:
        3000,

      sellImpact:
        0.10,

      top1:
        5,

      devHolding:
        18,

      roi:
        90,

      ageSeconds:
        180,
    },
  },

  {
    name:
      'Breakout after allowed window',

    candidate: {
      decision:
        'TRACK_ONLY',

      source:
        'PONS',

      marketCap:
        3000,

      liquidity:
        3000,

      sellImpact:
        0.10,

      top1:
        5,

      devHolding:
        2,

      roi:
        100,

      ageSeconds:
        420,
    },
  },

  {
    name:
      'DEXSCREENER candidate',

    candidate: {
      decision:
        'TRACK_ONLY',

      source:
        'DEXSCREENER',

      marketCap:
        3000,

      liquidity:
        3000,

      sellImpact:
        0.10,

      top1:
        5,

      devHolding:
        2,

      roi:
        100,

      ageSeconds:
        120,
    },
  },
] satisfies Array<{
  name: string;

  candidate:
    TestCandidate;
}>;


console.log(
  '\n🔥 AlphaOS Robinhood MICRO BREAKOUT Logic Test\n',
);


let passed =
  0;


for (
  const test of tests
) {
  const result =
    evaluate(
      test.candidate,
    );


  console.log(
    test.name,
  );

  console.log({
    trigger:
      result.trigger,

    reasons:
      result.reasons,
  });


  console.log('');


  const expectedTrigger =
  test.name ===
    'BROODZ-style 2m breakout' ||
  test.name ===
    'Unknown initial dev but valid breakout';


  if (
    result.trigger ===
    expectedTrigger
  ) {
    passed += 1;
  }
}


console.log(
  `✅ ${passed}/${tests.length} tests behaved as expected.`,
);


if (
  passed !==
  tests.length
) {
  process.exitCode =
    1;
}