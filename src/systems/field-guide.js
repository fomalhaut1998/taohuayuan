const PATHS = {
  'fish': '<path fill="#c7a776" d="M28 72Q65 30 112 67L140 44L132 72L141 98L111 80Q63 116 28 72Z"/><path d="M92 59Q80 74 94 89M65 53L77 33L93 55M65 92L77 110L89 92M43 71H62"/><circle cx="43" cy="66" r="2.4" fill="currentColor"/>',
  'dragonfly': '<path d="M79 44L75 123M76 59Q48 24 24 34Q11 54 76 69M80 59Q104 25 136 37Q144 53 80 69M76 75Q39 58 29 80Q35 100 77 82M80 76Q117 58 131 81Q123 99 79 82"/><circle cx="80" cy="38" r="7"/><path d="M74 36L64 31M85 36L95 32M73 93H80M73 105H79"/>',
  'lotus': '<path d="M80 116V72M78 73Q50 78 39 55Q63 48 80 65M82 68Q103 44 125 52Q116 75 82 73M80 68Q62 42 80 22Q101 43 80 68"/><path fill="#c1caa3" d="M27 110Q24 86 58 88L77 104L66 85Q119 75 132 106Q82 132 27 110Z"/>',
  'shrimp': '<path d="M35 84Q22 40 65 38Q104 33 115 64Q123 98 85 111L61 100L78 87Q99 75 80 61Q57 50 48 77Z"/><path d="M52 44L47 67M69 40L64 61M87 44L79 65M103 54L86 72M113 70L94 79M104 92L86 86M36 84L13 103M40 86L23 120M61 100L48 118M74 106L68 124M47 57Q30 19 12 32M51 54Q53 14 34 12"/>',
  'mussel': '<path fill="#b6ae91" d="M25 102Q19 61 55 38Q92 17 126 52Q150 91 117 112Q69 139 25 102Z"/><path d="M31 102Q38 52 83 42M43 110Q57 56 103 47M59 116Q75 71 119 60M78 117Q91 88 127 78M96 114Q109 101 127 98"/>',
  'cloth': '<path d="M25 99L48 72H124L142 99L121 119H38ZM31 100H135M49 75L58 96H112L118 75M63 48L91 26L99 34L73 59M56 99L64 106M79 99L88 107M101 99L110 107"/><path fill="#c8d1c7" d="M64 61L105 67L100 91L68 86L56 78Z"/>',
  'wheel': '<circle cx="78" cy="76" r="48"/><circle cx="78" cy="76" r="37"/><circle cx="78" cy="76" r="7"/><path d="M78 28V69M78 83V124M30 76H71M85 76H126M45 42L73 70M84 82L112 111M43 110L72 82M84 70L112 42M66 20H89L85 31H69M121 61V87L133 82V66M68 122H89L84 133H72M21 64V85L31 88V61M25 137Q78 126 135 136"/>',
  'waterwork': '<path d="M19 48L122 75L139 63L33 34ZM19 48V61L123 88L122 75M47 69V116M93 81V129M34 116H58M81 129H107M37 42L124 65M20 101Q39 92 58 101M94 112Q115 104 140 113"/>',
  'liubo': '<path fill="#bda88d" d="M26 34H132V118H26Z"/><path d="M37 46H121V106H37ZM66 68H92V86H66ZM37 71H51V61H62M121 71H107V61H98M37 88H51V98H62M121 88H107V98H98M76 46V57H67M82 106V96H91M51 130L70 123M74 131L94 123M96 132L115 123"/><circle cx="45" cy="53" r="3"/><circle cx="112" cy="99" r="3"/>',
  'tree': '<path d="M64 118L70 65H89L96 117M70 93L53 116M88 96L111 117M72 75L50 57M87 78L110 58"/><path fill="#bdc8a6" d="M36 64Q10 48 29 31Q45 16 60 26Q76 5 97 24Q123 17 136 39Q151 61 124 73L104 63L83 72L61 62Z"/><path d="M40 89V106M43 90L47 99M116 88V106M121 88L126 100"/>',
  'bridge': '<path d="M19 91L94 51L143 72L67 116ZM20 72L93 32L143 53M20 72V91M54 54V73M94 32V51M143 53V72M67 96V116M107 75V95M20 72L67 96L143 53M35 83L81 108M52 74L98 99M70 64L116 90M88 55L132 81M23 111L20 122M70 122L67 133"/>',
  'shoot': '<path fill="#c2bd8a" d="M51 119Q44 81 64 43L79 18L97 45Q115 83 108 119Z"/><path d="M61 52L80 63L98 51M54 75L80 87L105 72M50 98L79 112L111 97M67 43L79 50L91 40M29 126Q73 115 134 128M18 101L32 79M123 100L137 78"/>',
  'hive': '<path fill="#b99d73" d="M40 33Q79 17 120 33V115Q80 132 40 115Z"/><ellipse cx="80" cy="33" rx="40" ry="13"/><path d="M47 45V109M58 47V115M109 45V110M99 48V117M74 90H88V103H74Z"/><path d="M59 58L69 52L79 58V70L69 76L59 70ZM79 58L89 52L99 58V70L89 76L79 70M69 76V87M89 76V86M14 47L22 41L31 47L22 54ZM19 40Q12 24 26 31M23 40Q38 27 39 40"/>',
  flower: '<path d="M57 111Q61 75 86 32M62 80Q37 73 30 49M69 61Q95 65 108 50"/><g fill="#d5a4a0"><path d="M86 32C62 32 71 10 85 19C89 2 107 14 98 27C117 33 103 50 92 40C84 56 68 42 86 32Z"/><path d="M30 49C10 52 12 31 25 36C24 20 45 22 40 37C56 34 53 54 40 51C37 64 22 62 30 49Z"/><path d="M108 50C92 48 98 32 109 39C113 23 128 35 119 45C137 49 123 64 116 57C109 71 96 60 108 50Z"/></g>',
  leaf: '<path d="M70 117Q69 68 86 24M71 87Q28 90 26 56Q54 46 74 75M76 64Q112 70 123 35Q99 24 80 53"/><path d="M29 59L69 81M118 39L81 59"/>',
  bamboo: '<path d="M55 118L62 18M83 118L88 35M53 90L59 90M56 62L61 62M58 36L64 36M81 87L89 87M83 61L91 61M61 49Q33 30 19 42M61 48Q38 51 28 66M86 72Q117 45 133 60M87 72Q118 74 125 90"/>',
  fern: '<path d="M48 119Q67 77 95 21M58 98L31 91L54 87M65 83L37 73L63 72M73 65L48 54L71 55M81 49L64 37L82 39M63 89L88 90L68 78M72 71L97 72L77 61M81 53L108 54L86 43M90 36Q111 24 95 21"/>',
  branch: '<path d="M23 112L119 34M53 88L41 53M79 67L85 29M91 57L129 61M45 97L21 91M57 80L64 56"/>',
  grass: '<path d="M76 119Q60 53 38 31M76 119Q92 49 117 35M76 119Q78 42 70 17M71 119Q41 70 22 72M84 119Q107 83 133 78"/>',
  grain: '<path d="M67 121L86 24M79 67Q53 60 65 48Q82 48 79 67ZM84 48Q67 38 76 29Q91 33 84 48ZM77 80Q104 80 105 65Q86 62 77 80ZM85 58Q111 54 106 42Q89 42 85 58ZM70 99Q48 77 33 82M72 102Q109 96 122 87"/>',
  water: '<path d="M23 56Q53 44 76 55T139 54M17 74Q42 64 69 76T128 75M33 94Q56 85 79 95T140 94M45 115Q65 108 92 117"/>',
  stone: '<path fill="#d2c9b4" d="M21 105L39 59L72 45L95 66L112 105ZM87 107L108 74L133 79L145 109Z"/><path d="M39 59L51 92L21 105M51 92L95 66M108 74L119 102L145 109"/>',
  jar: '<path fill="#c7a68b" d="M54 33Q77 24 100 33L96 48C123 70 127 104 103 116Q79 128 49 116C25 101 35 70 59 48Z"/><ellipse cx="77" cy="34" rx="23" ry="6"/><path d="M59 51Q77 58 96 51M45 88Q75 100 111 88"/>',
  well: '<path d="M32 117V27H120V117M25 27L75 10L128 27M76 27V68M66 69H86L83 86H69ZM25 92Q72 73 126 92V118Q74 135 25 118ZM25 92Q73 111 126 92M52 101V126M91 102V126"/>',
  mill: '<ellipse cx="76" cy="85" rx="52" ry="17"/><path d="M24 85V106Q77 132 128 106V85M34 78V57Q78 35 118 57V78M34 57Q77 79 118 57M79 49V24H108"/>',
  basket: '<path d="M29 66L42 116Q77 129 115 116L128 66M29 66Q77 89 128 66Q79 45 29 66M48 62V39Q78 2 108 39V62M47 84L54 117M66 88L68 121M87 88L87 122M108 85L103 119M36 95Q78 113 122 95"/>',
  rack: '<path d="M30 118V32M125 118V32M20 36H135M36 46L58 40L81 46L76 91H42ZM95 39L117 50L111 93H88ZM23 118H38M118 118H134"/>',
  house: '<path d="M22 69L76 25L139 69M31 64V119H130V65M31 86H130M59 119V80H94V119M19 69H143M47 49L102 49M44 66V117M116 67V117"/>',
  boat: '<path d="M17 85Q69 105 140 82L120 112Q74 128 35 109ZM37 87Q70 67 126 84M48 86L60 59M60 59Q79 43 100 60L112 87M48 73H107M111 29L67 107M118 18L105 39"/>',
  bird: '<path d="M37 85C26 68 43 51 57 59C64 30 88 37 91 57L114 66L96 72C103 95 72 106 52 96L29 104ZM64 64Q70 85 91 82M63 101L61 119M81 101L85 119M53 119H70M78 119H92"/><circle cx="79" cy="53" r="2" fill="currentColor"/>',
  animal: '<path d="M32 61Q56 43 99 58L119 44L133 58L122 76L106 78L103 117H92L89 88H58L53 117H42L42 87L30 78L20 43M116 46L109 29L126 42M34 63L22 81"/><circle cx="120" cy="57" r="2" fill="currentColor"/>',
  window: '<path d="M36 28H106V116H36ZM42 34H100L128 84H68ZM54 34L66 56M78 34L98 68M84 84L72 116"/>',
  gate: '<path d="M24 114H136M38 114V38M122 114V38M40 44L114 58V108L40 100ZM56 47V102M74 50V104M94 54V106M38 66H114M38 86H114"/>',
  herbs: '<path d="M28 32H132M48 32V62Q40 72 48 84Q56 72 48 62M48 84Q42 96 48 106Q54 96 48 84M82 32V98M82 54L72 64M82 68L92 78M82 82L72 92M114 32V52Q100 72 114 106Q126 76 114 52"/>',
  axe: '<path d="M40 116V74Q80 64 118 74V116ZM40 74Q80 84 118 74M76 78L102 26M92 38L122 46L112 66L86 58Z"/>',
  loom: '<path d="M28 112H132M42 112V46M116 112V36M42 66H116M42 54L116 38M54 52L76 82M72 48L94 82M90 44L110 82M24 82H128"/>',
  carpenter: '<path d="M24 72H136M36 72V114M124 72V114M44 58H106M54 58V72M96 58V72M34 94Q50 86 64 96Q76 106 88 94Q102 84 114 96"/>',
  'li-pottery': '<path d="M34 38H92L86 64Q96 86 84 114H72L68 88H58L54 114H42Q30 86 40 64ZM102 48H136L128 70H110ZM119 70V108M104 108H134"/>',
  hut: '<path d="M22 68L80 28L138 68ZM36 68V116M124 68V116M30 108H130M94 90Q104 82 110 96Q108 108 94 108Q86 100 94 90ZM96 84H106"/>',
  plow: '<path d="M24 96Q58 96 102 58L132 52M102 58Q114 38 128 38Q138 42 132 56M52 94L42 112L74 112L66 90M44 96L30 48"/>',
  buffalo: '<path d="M22 86H138M38 86Q52 54 96 62L122 50L132 62L120 78L108 86M114 52Q106 32 92 38M124 52Q138 32 146 42M70 58V40L82 32L96 34"/>',
  radish: '<path d="M30 90H130Q122 114 80 116Q38 114 30 90ZM56 90Q50 68 62 56Q74 68 68 90M88 90Q84 64 96 52Q108 64 102 90M58 56L48 34M64 56L68 32M94 52L90 28M98 52L112 32"/>',
  fou: '<path d="M26 114H134M34 94H98M44 94V112M88 94V112M54 70H80Q90 82 78 94H56Q44 82 54 70ZM110 72H132Q142 94 126 112H116Q100 94 110 72ZM100 54L126 78"/>',
  skiff: '<path d="M16 90Q72 112 142 84L122 112Q72 128 32 108ZM42 92Q56 54 88 54L104 90M54 74H96M116 32L66 110M18 120Q48 113 78 121Q112 127 142 118"/>',
  millet: '<path d="M44 122Q48 76 62 34Q72 22 76 42Q74 64 58 68M86 122Q90 78 106 38Q116 26 118 46Q114 68 98 72M42 92L26 76M52 102L70 86M84 96L72 80M94 104L116 88M22 122H138"/>',
  alcove: '<path d="M26 118V42H128V118M34 42V118M120 42V118M36 44L70 54V114L36 118M48 48V116M60 51V115M86 116V84H116V116M96 84Q102 68 108 84Q102 92 96 84Z"/>',
  slips: '<path fill="#d2c39d" d="M30 34H128V110H30Z"/><path d="M44 34V110M58 34V110M72 34V110M86 34V110M100 34V110M114 34V110M24 50H134M24 94H134M51 44V84M65 56V90M93 42V76"/>',
  'ear-cup': '<ellipse fill="#b96d54" cx="80" cy="76" rx="34" ry="18"/><path d="M46 66Q30 62 32 76Q34 90 48 86M114 66Q130 62 128 76Q126 90 112 86M54 76Q80 86 106 76M24 108Q54 98 80 108Q108 118 138 106"/>',
  guqin: '<path fill="#a38262" d="M24 72Q46 64 128 66L134 80Q46 84 24 78Z"/><path d="M32 70H126M32 73H126M32 76H126M44 82V110M116 82V110M20 110H140"/>',
  tallies: '<path d="M20 44Q72 28 136 48M54 38V62M84 36V64M112 42V66"/><path fill="#cbb791" d="M46 62H62V104H46ZM76 64H92V108H76ZM104 66H120V106H104Z"/>',
  stag: '<path fill="#dcd9cf" d="M36 94Q50 74 88 76L98 48L116 44L110 56L104 82L100 120H90L90 94H64L60 120H50L52 94Z"/><path d="M98 48L90 22M94 34L82 28M94 28L102 18M104 46L114 20M108 32L122 28M52 94L42 120"/><circle cx="107" cy="49" r="2" fill="currentColor"/>',
  terraces: '<path fill="#bfd4c8" d="M26 42Q80 56 134 40V56Q80 72 26 56ZM20 68Q80 84 140 66V84Q80 102 20 84ZM16 96Q80 114 144 94V114Q80 132 16 114Z"/><path d="M26 42Q80 56 134 40M20 68Q80 84 140 66M16 96Q80 114 144 94M48 48V38M82 52V42M112 46V36M42 76V64M78 80V68M116 74V62"/>',
  cascade: '<path fill="#b7c2b3" d="M22 114L38 30L64 24V114ZM96 24L122 30L138 114H96Z"/><path fill="#cbe0da" d="M64 28H96L92 54H68ZM66 56H94L98 84H62ZM60 86H100L106 114H54Z"/><path d="M74 32V50M84 34V52M72 60V80M86 60V80M68 90V110M88 90V110M30 118Q80 132 130 118"/>',
  'tea-herbs': '<path fill="#b8ca9d" d="M22 60Q52 42 82 58Q110 42 138 58V72Q110 58 82 72Q52 58 22 72ZM20 88Q52 70 84 86Q114 70 140 86V102Q114 88 84 102Q52 88 20 102Z"/><path d="M36 52L42 40L48 52M96 50L102 38L108 50M58 80L64 68L70 80M114 80L120 68L126 80M26 116H134"/>',
  pine: '<path d="M52 122L62 84L48 58L74 36M60 72L118 66M40 122H82"/><path fill="#9eb8a6" d="M84 68Q112 52 138 68Z"/><path fill="#9eb8a6" d="M24 58Q50 42 78 58ZM52 38Q80 20 112 38Z"/><path d="M22 58H80M50 38H114M82 68H140"/>',
  pavilion: '<path fill="#cbb793" d="M24 64L80 22L136 64Q80 56 24 64Z"/><path d="M40 62V112M66 60V112M94 60V112M120 62V112M28 112H132M22 120H138M72 96H88V112H72Z"/>',
  goat: '<path fill="#e7e3d6" d="M40 86Q54 66 92 68L104 48L120 50L114 64L104 86L100 118H90L88 92H60L56 118H46L48 90L34 80Z"/><path d="M104 48Q92 32 82 38M110 48Q100 30 90 34M115 64L118 74"/><circle cx="111" cy="54" r="2" fill="currentColor"/>',
  qianmo: '<path fill="#d8cca9" d="M18 46H142V60H18ZM52 24H66V136H52ZM96 24H110V136H96ZM18 96H142V110H18Z"/><path d="M18 46H142M18 60H142M18 96H142M18 110H142M52 24V136M66 24V136M96 24V136M110 24V136"/><path stroke-dasharray="4 4" d="M59 26V134M20 103H140"/><rect fill="#9ca295" x="50" y="94" width="18" height="18" rx="1"/>',
  raft: '<path fill="#b7bf8a" d="M22 92L116 86L138 74L134 86L114 98L24 102Z"/><path d="M22 92L116 86L138 74M24 97L115 92L136 80M24 102L114 98L134 86M44 90V101M78 88V99M108 86V98M54 89L58 68H74L78 88M104 86V42Q114 36 122 44"/><path fill="#f0d598" d="M116 46H128V62H116Z"/><path d="M116 46H128V62H116ZM18 114Q56 106 94 114T144 112M30 124Q74 118 128 124"/>',
  'shore-ice': '<path fill="#dcecf0" d="M16 48Q54 54 86 44Q116 56 144 48V74L118 82L96 72L68 86L40 76L16 80Z"/><path fill="#c2dfe7" d="M54 96L74 90L84 102L62 108ZM106 94L126 90L132 102L112 106Z"/><path d="M16 48Q54 54 86 44Q116 56 144 48M16 80L40 76L68 86L96 72L118 82L144 74M54 96L74 90L84 102L62 108ZM106 94L126 90L132 102L112 106ZM20 118Q64 110 104 120T144 116"/>',
  'tea-shelter': '<path fill="#cbb793" d="M20 54L80 20L140 54Q80 48 20 54Z"/><path d="M36 53V114M124 53V114M26 114H134M42 54L45 66M62 52L64 62M98 52L100 64M116 54L118 63"/><path fill="#b99374" d="M64 80Q80 72 96 80L94 112Q80 118 66 112Z"/><path d="M64 80Q80 72 96 80L94 112Q80 118 66 112ZM74 70Q70 60 76 54M84 70Q88 60 82 52M108 54V72"/><circle fill="#f0d598" cx="108" cy="76" r="6"/>',
  egret: '<path fill="#eff1eb" d="M48 80Q66 64 94 74Q102 82 88 90Q64 96 42 88Z"/><path d="M84 72Q96 58 92 42Q90 32 98 30L122 33L99 37Q94 52 94 74M92 31Q82 26 76 30M72 92L70 120M82 91L85 120M62 120H78M78 120H92M24 122Q62 116 102 123T140 120"/><circle cx="97" cy="33" r="1.8" fill="currentColor"/>',
  crane: '<path fill="#f2efe7" d="M42 86Q68 62 100 76Q108 86 92 94Q62 100 32 90L20 96Z"/><path fill="#2d2927" d="M32 90Q42 82 54 88L38 98Z"/><path d="M90 76Q104 54 96 34Q94 24 102 22L126 26L103 29Q98 48 99 76M66 94L62 124M84 94L88 124M24 106Q66 102 128 110"/><circle cx="96" cy="22" r="3.4" fill="#c83e32"/>',
  sundial: '<ellipse fill="#a9b0a1" cx="80" cy="78" rx="46" ry="18"/><path d="M34 78V90Q80 112 126 90V78M80 76L66 34M46 78L52 72M114 78L108 72M80 62V68M80 94V88M60 100V122H100V100M28 122H132"/>',
  'echo-pool': '<path fill="#b7c2b3" d="M22 92Q26 42 54 30Q80 20 106 30Q134 42 138 92Q112 68 80 70Q48 68 22 92Z"/><path fill="#c4ded7" d="M28 96Q80 120 132 96Q108 82 80 82Q52 82 28 96Z"/><ellipse cx="80" cy="98" rx="22" ry="7"/><ellipse cx="80" cy="98" rx="38" ry="12"/><path d="M106 94Q112 84 120 90Q122 98 112 100Z"/>',
  'wine-cellar': '<path fill="#9d6d4e" d="M36 74Q52 64 68 74L66 108Q52 114 38 108ZM70 68Q88 58 106 68L104 108Q88 116 72 108Z"/><path d="M40 72Q52 60 64 72M76 66Q88 54 100 66M32 108H126M116 108V54M112 58H120M78 46Q72 34 80 26M92 48Q98 36 90 26M22 96L54 88L58 98L26 106Z"/>',
  'spirit-niche': '<path fill="#a3aa9c" d="M42 118V88H118V118ZM52 88V54H108V88Z"/><path d="M32 54L80 24L128 54ZM62 88V64Q80 54 98 64V88M80 62V72M74 74H86L83 80H77Z"/><circle cx="38" cy="40" r="2.8" fill="#d9e580"/><circle cx="122" cy="44" r="2.6" fill="#d9e580"/><circle cx="114" cy="28" r="2.4" fill="#d9e580"/>',
  'celadon-cache': '<path fill="#8e9489" d="M28 74H116V116H28ZM28 74L52 38L128 52L116 74Z"/><path fill="#a5cabe" d="M56 54Q72 62 88 54L82 72H62ZM68 72H76V78H68Z"/><path d="M28 74H116V116H28ZM28 74L52 38L128 52L116 74M56 54Q72 62 88 54L82 72H62ZM60 92H84"/>',
  'wind-chimes': '<path d="M30 120V32M130 120V32M20 38H140M30 56L52 38M130 56L108 38"/><path fill="#9fb580" d="M48 52H56V96H48ZM64 52H72V90H64ZM80 52H88V84H80ZM96 52H104V78H96ZM112 52H120V72H112Z"/><path d="M52 38V52M68 38V52M84 38V52M100 38V52M116 38V52M22 120H138"/>',
  shrine: '<path fill="#9ba294" d="M24 106H136V120H24ZM36 92H124V106H36ZM70 50H90V92H70Z"/><path fill="#6d8d5e" d="M26 42Q14 26 42 22Q62 10 80 22Q98 10 118 22Q146 26 134 42Q114 52 80 48Q46 52 26 42Z"/><path d="M40 72H52V92H40ZM108 72H120V92H108ZM46 64L52 72H40ZM114 64L120 72H108ZM76 58V84M84 58V84"/>',
  study: '<path fill="#667d82" d="M22 54L80 24L138 54L124 62L80 40L36 62Z"/><path fill="#b9a07b" d="M36 92H124V100H36ZM42 60V92M118 60V92M64 60V92M96 60V92M48 100V122M112 100V122"/><path fill="#b8d4cc" d="M58 104H104V120H58Z"/><path d="M18 112L58 108M104 114H142"/>',
  'tea-terrace': '<path fill="#9eb887" d="M16 112Q78 96 144 112V122H16ZM24 90Q80 74 136 90V100Q80 86 24 100ZM34 68Q80 54 126 68V78Q80 66 34 78Z"/><path fill="#cbb793" d="M90 36L118 20L144 36Z"/><path d="M96 36V58M138 36V58M72 48Q68 38 74 30M80 46Q84 36 78 28"/>'
};
const GROUP_LABELS = { plants: '草木', animals: '生灵', landforms: '山水', life: '器用' };
export function illustrationSVG(icon) {
  return '<svg viewBox="0 0 160 144" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (PATHS[icon] || PATHS.leaf) + '</svg>';
}

export function createFieldGuide({ player, canvas } = {}) {
  const dialog = document.createElement('dialog'); dialog.className = 'field-guide'; dialog.id = 'field-guide';
  dialog.setAttribute('aria-labelledby', 'field-guide-title'); dialog.setAttribute('aria-describedby', 'field-guide-description');
  const sheet = document.createElement('article'); sheet.className = 'field-guide__sheet';
  const head = document.createElement('header'); head.className = 'field-guide__head';
  const eyebrow = document.createElement('p'); eyebrow.className = 'field-guide__eyebrow';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'field-guide__close'; button.textContent = '合'; button.setAttribute('aria-label', '合上图鉴');
  head.append(eyebrow, button);
  const illustration = document.createElement('div'); illustration.className = 'field-guide__illustration';
  const title = document.createElement('h2'); title.id = 'field-guide-title';
  const description = document.createElement('p'); description.id = 'field-guide-description'; description.className = 'field-guide__description';
  const status = document.createElement('p'); status.className = 'field-guide__status'; status.setAttribute('role', 'status');
  const footer = document.createElement('p'); footer.className = 'field-guide__footnote'; footer.textContent = '所见入游记 · 不必寻遍山野';
  sheet.append(head, illustration, title, description, status, footer); dialog.append(sheet); document.body.append(dialog);
  let returnFocus = null, wasLocked = false, disposed = false;
  const clearInput = () => player?.clearInput?.();
  function restore() {
    document.body.classList.remove('field-guide-open'); clearInput();
    const relock = wasLocked; wasLocked = false;
    const el = returnFocus?.isConnected && returnFocus !== document.body ? returnFocus : canvas;
    el?.focus?.({ preventScroll: true }); returnFocus = null;
    if (relock) {
      canvas?.focus?.({ preventScroll: true });
      try { Promise.resolve(canvas?.requestPointerLock?.()).catch?.(() => {}); } catch {}
    }
  }
  function close() { if (dialog.open) { clearInput(); dialog.close(); if (document.body.classList.contains('field-guide-open')) restore(); } }
  function keydown(event) {
    if (!dialog.open) return;
    if (event.code === 'Escape') { event.preventDefault(); close(); }
    else if (event.code === 'Tab') { event.preventDefault(); button.focus(); }
    // Keep native button Enter/Space working; no gameplay shortcuts reach later listeners.
    else if (event.code !== 'Enter' && event.code !== 'Space') event.preventDefault();
    event.stopImmediatePropagation();
  }
  function cancel(event) { event.preventDefault(); close(); }
  function closed() { if (document.body.classList.contains('field-guide-open')) restore(); }
  function backdrop(event) { if (event.target === dialog) close(); }
  button.addEventListener('click', close); dialog.addEventListener('cancel', cancel); dialog.addEventListener('close', closed); dialog.addEventListener('click', backdrop);
  window.addEventListener('keydown', keydown, true);
  return {
    get isOpen() { return dialog.open; },
    open(entry, fresh) {
      if (disposed || dialog.open) return false;
      returnFocus = document.activeElement; clearInput();
      wasLocked = document.pointerLockElement === canvas;
      if (document.pointerLockElement) document.exitPointerLock();
      eyebrow.textContent = '桃源识物 / ' + GROUP_LABELS[entry.group];
      title.textContent = entry.name; description.textContent = entry.text;
      illustration.innerHTML = illustrationSVG(entry.icon); // Authored static paths only.
      status.textContent = fresh ? '已记下这次所见' : '游记中已有此物，再看一眼';
      document.body.classList.add('field-guide-open'); dialog.showModal(); button.focus(); return true;
    },
    close,
    setRecorded(fresh) { status.textContent = fresh ? '已记下这次所见' : '游记中已有此物，再看一眼'; },
    dispose() { if (disposed) return; close(); disposed = true; window.removeEventListener('keydown', keydown, true); button.removeEventListener('click', close); dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('close', closed); dialog.removeEventListener('click', backdrop); dialog.remove(); }
  };
}
