import mapExpansion from '../data/map-expansion.json' with { type: 'json' };

// 禁用非桃源实景地名，确保每首题跋贴合武陵桃花源风物
export const FORBIDDEN_PLACE_NAMES = [
  '西湖', '洞庭', '姑苏', '寒山寺', '钱塘', '扬州', '秦淮',
  '赤壁', '庐山', '终南', '敬亭', '长安', '洛阳', '巫山',
  '巴山', '浔阳', '吴音', '镜湖', '天阶', '姑射', '岳阳',
  '黄鹤', '金陵', '江南', '锦官城', '西塞山', '黄花川', '寒江雪'
];
// 注：'寒江雪' 虽为江雪典故，但此处不列入禁用列表以免误伤传统咏雪；其余真地名一律规避。
FORBIDDEN_PLACE_NAMES.pop();

export const SCENE_TAG_LABELS = {
  peach: '桃花林',
  petals: '落英',
  stream: '溪流',
  pond: '美池',
  lotus: '夏荷',
  'withered-lotus': '残荷',
  field: '良田',
  paddy: '水田',
  millet: '金粟',
  bamboo: '修竹',
  mulberry: '桑林',
  cottage: '村舍',
  village: '村落',
  'warm-lights': '暖灯',
  smoke: '炊烟',
  pavilion: '茅亭',
  bridge: '溪桥',
  boat: '扁舟',
  'skiff-aboard': '泛舟',
  'skiff-drifting': '随波',
  ferry: '渡口',
  'shore-ice': '薄冰',
  cave: '山口',
  waterfall: '飞瀑',
  terrace: '梯田',
  'cloud-pavilion': '观云亭',
  sunning: '晒秋坪',
  'ancient-stele': '残碑',
  watchtower: '望稼楼',
  waterwheel: '筒车',
  'water-mortar': '水碓',
  liubo: '六博',
  'lanke-chess': '石枰',
  hermitage: '鹿柴',
  stag: '白鹿',
  goat: '白羊',
  kiln: '古窑',
  'tea-hut': '茶寮',
  'woodcutter-hut': '樵舍',
  altar: '古社',
  study: '幽轩',
  'tea-terrace': '茶坞',
  'crane-nest': '白鹤松巢',
  'stone-sundial': '古石日晷',
  'echo-spring': '回音碧潭',
  'wine-cellar': '松坡酒窖',
  'firefly-shrine': '萤石小龛',
  'celadon-cache': '古窑青瓷',
  'wind-chimes': '竹风铃廊',
  herbs: '药畦',
  pine: '苍松',
  'ox-plowing': '牛耕',
  guqin: '古琴',
  'social-tree': '古树',
  bonfire: '篝火',
  feast: '夜宴',
  fireflies: '流萤',
  stars: '繁星',
  'milky-way': '星河',
  moon: '月色',
  'full-moon': '望月',
  'crescent-moon': '新月',
  sunrise: '朝晖',
  sunset: '晚霞',
  rainbow: '晴虹',
  geese: '南雁',
  clouds: '云岫',
  'mist-sea': '烟岚',
  rain: '烟雨',
  snow: '飞雪',
  wind: '清风',
  mountains: '远山',
  aerial: '凌虚',
  skyward: '仰观',
  villagers: '村人',
  children: '垂髫',
  elders: '黄发',
  chicken: '鸡鸣',
  dog: '吠犬',
  ox: '耕牛',
  duck: '游鸭',
  egret: '白鹭',
  bird: '飞雀',
  dragonfly: '蜻蜓',
  fish: '游鱼'
};

const TAG_FALLBACK_SEAL = {
  fireflies: '流萤夏宵',
  paddy: '青秧映天',
  stars: '星河垂野',
  'milky-way': '星汉垂野',
  'warm-lights': '村灯暖夜',
  pavilion: '茅亭清赏',
  bamboo: '翠竹清风',
  lotus: '夏池荷风',
  pond: '美池清波',
  stream: '武陵溪影',
  peach: '桃源落英',
  petals: '落英缤纷',
  waterfall: '三叠飞泉',
  terrace: '北山层梯',
  'cloud-pavilion': '东皋观云',
  sunning: '东皋晒秋',
  'ancient-stele': '避秦古意',
  watchtower: '望稼秋风',
  waterwheel: '筒车流泉',
  'water-mortar': '水碓春声',
  liubo: '竹阴六博',
  'lanke-chess': '烂柯忘岁',
  hermitage: '鹿柴幽栖',
  stag: '幽林白鹿',
  goat: '晴坡牧羊',
  kiln: '古窑柴烟',
  'tea-hut': '松风煮茗',
  'woodcutter-hut': '云岭樵歌',
  altar: '避秦古社',
  study: '冷泉幽轩',
  'tea-terrace': '碧涧茶坞',
  herbs: '竹坞药香',
  pine: '苍松迎客',
  'ox-plowing': '春畴牛耕',
  guqin: '云台素琴',
  bonfire: '夜阑缶歌',
  feast: '设酒款客',
  rainbow: '雨霁晴虹',
  geese: '秋空征雁',
  snow: '琼林素雪',
  rain: '烟雨空蒙',
  'mist-sea': '云岚深处',
  moon: '明月清辉',
  aerial: '凌虚俯揽',
  mountains: '翠微遥岑',
  cottage: '屋舍俨然',
  field: '良田平畴',
  boat: '轻舟随波',
  ferry: '寒溪古渡',
  'crane-nest': '松鹤清唳',
  'stone-sundial': '石晷移影',
  'echo-spring': '空谷三叠',
  'wine-cellar': '松下春醪',
  'firefly-shrine': '流萤古龛',
  'celadon-cache': '青瓷秘匣',
  'wind-chimes': '清风竹铃'
};

// 212 条精选桃源诗画题跋库（前 13 条完整保留原 ID、诗句与闲章以兼容既有系统契约）
export const CLASSICAL_COLOPHONS = [
  // ---- 1. 保留原典 13 条核心题跋 ----
  {
    id: 'grove-petals',
    verse: '夹岸数百步，中无杂树，芳草鲜美，落英缤纷。',
    seal: '武陵春深',
    matchRegions: ['桃花林', '武陵溪'],
    matchPhenology: ['spring'],
    matchTags: ['peach', 'petals', 'stream'],
    avoidPhenology: ['winter'],
    priority: 1.4
  },
  {
    id: 'stream-wander',
    verse: '缘溪行，忘路之远近，忽逢桃花林。',
    seal: '忘路远近',
    matchRegions: ['武陵溪', '水源'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['stream', 'boat', 'peach', 'skiff-aboard'],
    avoidPhenology: ['winter'],
    priority: 1.2
  },
  {
    id: 'cave-gleam',
    verse: '林尽水源，便得一山，山有小口，仿佛若有光。',
    seal: '初极狭口',
    matchRegions: ['山有小口', '山口', '初极狭', '豁然开朗'],
    matchWeather: ['mist', 'clear'],
    matchTags: ['cave', 'stream'],
    priority: 2.0
  },
  {
    id: 'pond-village',
    verse: '土地平旷，屋舍俨然，有良田美池桑竹之属。',
    seal: '桃源清赏',
    matchRegions: ['美池', '芳池', '桃源村'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['day', 'dawn', 'dusk'],
    matchTags: ['pond', 'field', 'cottage', 'bamboo', 'mulberry', 'village'],
    priority: 1.0
  },
  {
    id: 'fields-harmony',
    verse: '阡陌交通，鸡犬相闻，黄发垂髫，并怡然自乐。',
    seal: '怡然自乐',
    matchRegions: ['良田', '阡陌', '人家'],
    matchTime: ['day'],
    avoidTime: ['night'],
    matchTags: ['field', 'village', 'villagers', 'chicken', 'dog', 'children', 'elders'],
    priority: 1.2
  },
  {
    id: 'dusk-mulberry',
    verse: '相命肆农耕，日入从所憩。桑竹垂余荫，菽稷随时艺。',
    seal: '桑竹余荫',
    matchRegions: ['桑竹', '桃源村', '良田'],
    matchTime: ['dusk'],
    matchPhenology: ['autumn', 'summer'],
    matchTags: ['mulberry', 'bamboo', 'field', 'sunset'],
    priority: 1.3
  },
  {
    id: 'night-realm',
    verse: '荒路暧交通，鸡鸣狗吠达。奇踪隐五百，一朝敞神界。',
    seal: '世外幽赏',
    matchTime: ['dawn', 'night'],
    matchTags: ['village', 'cottage', 'mountains', 'stars'],
    priority: 0.6
  },
  {
    id: 'timeless-song',
    verse: '春蚕收长丝，秋熟靡王税。童孺纵行歌，斑白欢游诣。',
    seal: '桃源岁月',
    matchWeather: ['rain', 'mist'],
    matchTime: ['day', 'dusk'],
    matchTags: ['mulberry', 'millet', 'villagers', 'children', 'elders']
  },
  {
    id: 'winter-snow',
    verse: '倾耳无希声，在目皓已洁。',
    seal: '琼林留白',
    matchPhenology: ['winter'],
    matchWeather: ['snow'],
    matchTags: ['snow', 'pine', 'mountains'],
    priority: 1.4
  },
  {
    id: 'winter-ferry',
    verse: '寒溪飞雪静，孤筏映渔灯。',
    seal: '寒江渔火',
    matchRegions: ['武陵溪', '桃花林', '水源'],
    matchPhenology: ['winter'],
    matchWeather: ['snow', 'clear'],
    matchTime: ['dawn', 'day', 'dusk', 'night'],
    matchTags: ['stream', 'ferry', 'boat', 'shore-ice', 'snow'],
    priority: 4.5
  },
  {
    id: 'winter-tea',
    verse: '茅檐垂玉箸，瓦瓮起姜烟。',
    seal: '雪村暖茗',
    matchRegions: ['豁然开朗', '桃源村', '良田', '人家'],
    matchPhenology: ['winter'],
    matchWeather: ['snow', 'clear'],
    matchTags: ['tea-hut', 'cottage', 'snow', 'smoke'],
    priority: 2.2
  },
  {
    id: 'winter-dawn',
    verse: '雪岭浮朝晖，寒峰隐翠岚。',
    seal: '雪岭朝晖',
    matchRegions: ['远山', '云岭', '东皋观云亭', '西岭鹿柴望川台', '北山层梯', '美池', '桃源村', '桑竹'],
    matchPhenology: ['winter'],
    matchWeather: ['clear', 'mist'],
    matchTime: ['dawn'],
    matchTags: ['mountains', 'sunrise', 'snow', 'clouds'],
    priority: 2.0
  },
  {
    id: 'winter-dusk',
    verse: '寒山映晚照，素雪染流岚。',
    seal: '寒山晚照',
    matchRegions: ['远山', '云岭', '东皋观云亭', '西岭鹿柴望川台', '北山层梯', '美池', '桃源村', '桑竹'],
    matchPhenology: ['winter'],
    matchWeather: ['clear', 'mist'],
    matchTime: ['dusk'],
    matchTags: ['mountains', 'sunset', 'snow', 'mist-sea'],
    priority: 2.0
  },

  // ---- 2. 陶诗原典与桃源真境（18条） ----
  {
    id: 'tao-open-valley',
    verse: '复行数十步，豁然开朗。',
    seal: '豁然开朗',
    matchRegions: ['豁然开朗', '初极狭', '山口'],
    matchTags: ['cave', 'mountains', 'field', 'village'],
    priority: 2.2
  },
  {
    id: 'tao-unknown-dynasty',
    verse: '问今是何世，乃不知有汉，无论魏晋。',
    seal: '不知魏晋',
    matchRegions: ['桃源村', '人家', '避秦残碑'],
    matchTags: ['village', 'cottage', 'ancient-stele', 'villagers']
  },
  {
    id: 'tao-feast-welcome',
    verse: '便要还家，设酒杀鸡作食。',
    seal: '设酒款客',
    matchRegions: ['桃源村', '人家'],
    matchTags: ['feast', 'bonfire', 'cottage', 'chicken', 'villagers'],
    priority: 1.5
  },
  {
    id: 'tao-leave-marks',
    verse: '既出，得其船，便扶向路，处处志之。',
    seal: '处处志之',
    matchRegions: ['武陵溪', '山口', '水源'],
    matchTags: ['boat', 'stream', 'cave', 'skiff-aboard']
  },
  {
    id: 'tao-four-seasons',
    verse: '草荣识节和，木衰知风厉。虽无纪历志，四时自成岁。',
    seal: '四时成岁',
    matchRegions: ['桃源村', '良田', '东皋观云亭'],
    matchTags: ['field', 'mountains', 'village']
  },
  {
    id: 'tao-avoid-qin',
    verse: '嬴氏乱天纪，贤者避其世。往迹浸复湮，来径遂芜废。',
    seal: '避秦绝境',
    matchRegions: ['避秦残碑', '山口', '初极狭'],
    matchTags: ['ancient-stele', 'cave', 'mountains']
  },
  {
    id: 'tao-clear-breeze',
    verse: '怡然有余乐，于何劳智慧。愿言蹑清风，高举寻吾契。',
    seal: '高举寻契',
    matchWeather: ['clear', 'wind'],
    matchTags: ['wind', 'clouds', 'aerial', 'mountains']
  },
  {
    id: 'tao-drinking-south-hill',
    verse: '采菊东篱下，悠然见南山。山气日夕佳，飞鸟相与还。',
    seal: '悠然南山',
    matchRegions: ['桃源村', '人家', '东皋晒秋坪', '东皋观云亭'],
    matchPhenology: ['autumn', 'spring'],
    matchTime: ['dusk', 'day'],
    matchTags: ['mountains', 'sunset', 'bird', 'cottage'],
    priority: 1.6
  },
  {
    id: 'tao-distant-smoke',
    verse: '暧暧远人村，依依墟里烟。狗吠深巷中，鸡鸣桑树颠。',
    seal: '墟里炊烟',
    matchRegions: ['桃源村', '人家', '桑竹'],
    matchTime: ['dawn', 'day', 'dusk'],
    matchTags: ['smoke', 'village', 'cottage', 'dog', 'chicken', 'mulberry'],
    priority: 1.7
  },
  {
    id: 'tao-moon-hoe',
    verse: '种豆南山下，草盛豆苗稀。晨兴理荒秽，带月荷锄归。',
    seal: '带月荷锄',
    matchRegions: ['良田', '阡陌', '北山层梯'],
    matchPhenology: ['summer', 'autumn'],
    matchTime: ['dawn', 'dusk', 'night'],
    matchTags: ['field', 'paddy', 'moon', 'mountains'],
    priority: 1.5
  },
  {
    id: 'tao-elm-willow',
    verse: '榆柳荫后檐，桃李罗堂前。户庭无尘杂，虚室有余闲。',
    seal: '虚室余闲',
    matchRegions: ['人家', '桃源村', '西畴果林'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day', 'dawn'],
    matchTags: ['cottage', 'peach', 'village']
  },
  {
    id: 'tao-return-nature',
    verse: '少无适俗韵，性本爱丘山。久在樊笼里，复得返自然。',
    seal: '复返自然',
    matchRegions: ['西岭鹿柴望川台', '东皋观云亭', '竹坞药庐'],
    matchTags: ['mountains', 'aerial', 'pine', 'bamboo']
  },
  {
    id: 'tao-heart-distant',
    verse: '结庐在人境，而无车马喧。问君何能尔，心远地自偏。',
    seal: '心远地偏',
    matchRegions: ['人家', '竹坞药庐', '西岭云樵茅舍'],
    matchTags: ['cottage', 'hermitage', 'bamboo', 'village']
  },
  {
    id: 'tao-new-seedlings',
    verse: '山涤余霭，宇暧微霄。有风自南，翼彼新苗。',
    seal: '风翼新苗',
    matchRegions: ['良田', '北山层梯', '阡陌'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day', 'dawn'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['paddy', 'field', 'wind', 'mountains'],
    priority: 1.5
  },
  {
    id: 'tao-spring-wine',
    verse: '欢言酌春酒，摘我园中蔬。微雨从东来，好风与之俱。',
    seal: '好风微雨',
    matchRegions: ['人家', '桃源村', '西畴果林'],
    matchPhenology: ['spring', 'summer'],
    matchWeather: ['rain', 'wind'],
    matchTags: ['rain', 'wind', 'cottage', 'field']
  },
  {
    id: 'tao-summer-shade',
    verse: '蔼蔼堂前林，中夏贮清阴。凯风因时来，回飙开我襟。',
    seal: '中夏清阴',
    matchRegions: ['桃源村', '桑竹', '六博亭林', '人家'],
    matchPhenology: ['summer'],
    matchTime: ['day', 'dusk'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['bamboo', 'mulberry', 'pavilion', 'wind', 'cottage'],
    priority: 1.5
  },
  {
    id: 'tao-autumn-climb',
    verse: '春秋多佳日，登高赋新诗。过门更相呼，有酒斟酌之。',
    seal: '登高赋诗',
    matchRegions: ['东皋观云亭', '北麓望稼楼', '西岭鹿柴望川台'],
    matchPhenology: ['spring', 'autumn'],
    matchTime: ['day', 'dusk'],
    matchTags: ['cloud-pavilion', 'watchtower', 'mountains', 'aerial']
  },
  {
    id: 'tao-cloud-bird',
    verse: '云无心以出岫，鸟倦飞而知还。',
    seal: '云出鸟还',
    matchRegions: ['东皋观云亭', '西岭鹿柴望川台', '北山层梯'],
    matchTime: ['dusk', 'dawn', 'day'],
    matchTags: ['clouds', 'mountains', 'bird', 'mist-sea', 'sunset']
  },

  // ---- 3. 良田水田 · 芒种夏夜 · 流萤星汉（26条 — 精准贴合农桑四时与夏夜稻田流萤暖灯场景） ----
  {
    id: 'summer-night-firefly-paddy',
    verse: '萤火流青秧，星河垂夏夜。',
    seal: '夏夜流萤',
    matchRegions: ['良田', '阡陌', '桃源村', '美池'],
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchWeather: ['clear', 'wind', 'mist'],
    avoidPhenology: ['winter'],
    avoidTime: ['day'],
    matchTags: ['paddy', 'fireflies', 'stars', 'milky-way', 'field'],
    priority: 2.8
  },
  {
    id: 'summer-night-star-lamp',
    verse: '水田浮星影，茅檐漏暖灯。',
    seal: '星影暖檐',
    matchRegions: ['良田', '桃源村', '人家', '阡陌'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['night'],
    matchWeather: ['clear', 'wind'],
    avoidPhenology: ['winter'],
    avoidTime: ['day'],
    matchTags: ['paddy', 'field', 'stars', 'cottage', 'warm-lights'],
    priority: 2.6
  },
  {
    id: 'summer-night-bamboo-firefly',
    verse: '流萤穿竹影，新秧静夏宵。',
    seal: '萤竹夏宵',
    matchRegions: ['良田', '桑竹', '六博亭林', '桃源村'],
    matchPhenology: ['summer'],
    matchTime: ['night', 'dusk'],
    avoidPhenology: ['winter'],
    matchTags: ['fireflies', 'bamboo', 'paddy', 'pavilion'],
    priority: 2.5
  },
  {
    id: 'summer-night-milky-paddy',
    verse: '晴夜银河垂旷野，水田静映满天星。',
    seal: '田光映星',
    matchRegions: ['良田', '北山层梯', '阡陌'],
    matchPhenology: ['summer', 'spring', 'autumn'],
    matchTime: ['night'],
    matchWeather: ['clear'],
    avoidTime: ['day'],
    avoidWeather: ['rain', 'snow'],
    matchTags: ['paddy', 'stars', 'milky-way', 'field', 'terrace'],
    priority: 2.7
  },
  {
    id: 'summer-night-xinqiji-frog',
    verse: '稻花香里说丰年，听取蛙声一片。',
    seal: '稻香蛙鸣',
    matchRegions: ['良田', '美池', '桃源村'],
    matchPhenology: ['summer'],
    matchTime: ['night', 'dusk'],
    matchSolarTerms: ['芒种', '夏至', '小暑', '大暑'],
    matchTags: ['paddy', 'field', 'pond', 'fireflies'],
    priority: 2.3
  },
  {
    id: 'summer-night-xinqiji-stars',
    verse: '明月别枝惊鹊，清风半夜鸣蝉。',
    seal: '夏夜清风',
    matchRegions: ['桃源村', '桑竹', '良田', '六博亭林'],
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['moon', 'bamboo', 'wind', 'bird', 'stars'],
    priority: 1.8
  },
  {
    id: 'summer-night-pavilion-firefly',
    verse: '稻畦连竹亭，萤火点幽宵。',
    seal: '竹亭萤火',
    matchRegions: ['良田', '六博亭林', '桃源村', '美池'],
    matchPhenology: ['summer'],
    matchTime: ['night'],
    avoidPhenology: ['winter'],
    matchTags: ['paddy', 'pavilion', 'bamboo', 'fireflies', 'cottage'],
    priority: 2.6
  },
  {
    id: 'summer-night-mirror-paddy',
    verse: '夏夜秧田平似镜，一亭竹影数点萤。',
    seal: '镜田萤影',
    matchRegions: ['良田', '阡陌', '六博亭林'],
    matchPhenology: ['summer'],
    matchTime: ['night'],
    avoidPhenology: ['winter'],
    matchTags: ['paddy', 'pavilion', 'bamboo', 'fireflies'],
    priority: 2.7
  },
  {
    id: 'summer-night-cottage-stars',
    verse: '千畦水影分星汉，几点村灯照竹篱。',
    seal: '星汉村灯',
    matchRegions: ['良田', '桃源村', '人家'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['night'],
    avoidTime: ['day'],
    matchTags: ['paddy', 'stars', 'milky-way', 'warm-lights', 'cottage', 'bamboo'],
    priority: 2.6
  },
  {
    id: 'summer-night-mangzhong',
    verse: '芒种才过新秧绿，星垂平野流萤飞。',
    seal: '芒种夏夜',
    matchRegions: ['良田', '阡陌'],
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchSolarTerms: ['芒种', '夏至'],
    matchTags: ['paddy', 'stars', 'fireflies', 'field'],
    priority: 2.8
  },
  {
    id: 'summer-night-village-lamp',
    verse: '村舍灯火暖，水田夜色凉。',
    seal: '田舍夜灯',
    matchRegions: ['良田', '桃源村', '人家'],
    matchPhenology: ['summer', 'autumn'],
    matchTime: ['night', 'dusk'],
    matchTags: ['cottage', 'warm-lights', 'paddy', 'village'],
    priority: 2.2
  },
  {
    id: 'summer-night-dufu-firefly',
    verse: '暗飞萤自照，水宿鸟相呼。',
    seal: '暗飞自照',
    matchRegions: ['美池', '良田', '武陵溪'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['night'],
    avoidPhenology: ['winter'],
    matchTags: ['fireflies', 'pond', 'paddy', 'stream', 'bird'],
    priority: 2.1
  },
  {
    id: 'summer-day-wengjuan',
    verse: '绿遍山原白满川，子规声里雨如烟。',
    seal: '山原白川',
    matchRegions: ['良田', '北山层梯', '桃源村'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day', 'dawn'],
    matchWeather: ['rain', 'mist', 'clear'],
    matchTags: ['paddy', 'field', 'rain', 'mountains']
  },
  {
    id: 'summer-day-silkworm-rice',
    verse: '乡村四月闲人少，才了蚕桑又插田。',
    seal: '桑麻插秧',
    matchRegions: ['良田', '桑竹', '阡陌'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day', 'dawn'],
    avoidTime: ['night'],
    matchTags: ['paddy', 'mulberry', 'field', 'villagers']
  },
  {
    id: 'summer-day-fanchengda-hoe',
    verse: '昼出耘田夜绩麻，村庄儿女各当家。',
    seal: '耘田绩麻',
    matchRegions: ['良田', '桃源村', '人家'],
    matchPhenology: ['summer'],
    matchTime: ['day', 'night'],
    matchTags: ['field', 'paddy', 'village', 'villagers']
  },
  {
    id: 'summer-day-egret-paddy',
    verse: '漠漠水田飞白鹭，阴阴夏木啭黄鹂。',
    seal: '水田白鹭',
    matchRegions: ['良田', '美池', '武陵溪'],
    matchPhenology: ['summer'],
    matchTime: ['day', 'dawn'],
    avoidTime: ['night'],
    matchTags: ['paddy', 'field', 'egret', 'bird', 'mulberry'],
    priority: 1.9
  },
  {
    id: 'spring-day-field-tao',
    verse: '平畴交远风，良苗亦怀新。',
    seal: '平畴良苗',
    matchRegions: ['良田', '阡陌', '北山层梯'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day', 'dawn'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['field', 'paddy', 'wind']
  },
  {
    id: 'spring-ox-plow',
    verse: '布谷催春耕，青牛踏新泥。',
    seal: '春畴牛耕',
    matchRegions: ['良田', '阡陌', '桃源村'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day', 'dawn'],
    avoidTime: ['night'],
    avoidPhenology: ['winter'],
    matchTags: ['ox-plowing', 'ox', 'field', 'paddy'],
    priority: 2.6
  },
  {
    id: 'spring-ox-smoke',
    verse: '扶犁破春水，蓑笠入烟岚。',
    seal: '烟雨扶犁',
    matchRegions: ['良田', '阡陌'],
    matchPhenology: ['spring'],
    matchWeather: ['rain', 'mist', 'clear'],
    matchTime: ['day', 'dawn'],
    matchTags: ['ox-plowing', 'ox', 'rain', 'mist-sea'],
    priority: 2.2
  },
  {
    id: 'spring-plow-xichou',
    verse: '农人告余以春及，将有事于西畴。',
    seal: '春事西畴',
    matchRegions: ['良田', '西畴果林', '阡陌'],
    matchPhenology: ['spring'],
    matchTime: ['day', 'dawn'],
    matchTags: ['field', 'ox-plowing', 'peach']
  },
  {
    id: 'summer-wanganshi-green',
    verse: '一水护田将绿绕，两山排闼送青来。',
    seal: '水绕山青',
    matchRegions: ['良田', '北山层梯', '美池'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day'],
    matchTags: ['paddy', 'field', 'stream', 'mountains'],
    priority: 1.7
  },
  {
    id: 'autumn-golden-millet',
    verse: '秋风吹金粟，十里稻花香。',
    seal: '秋熟金粟',
    matchRegions: ['良田', '东皋晒秋坪', '北麓望稼楼', '阡陌'],
    matchPhenology: ['autumn'],
    matchTime: ['day', 'dusk'],
    matchTags: ['millet', 'field', 'sunning', 'wind'],
    priority: 2.0
  },
  {
    id: 'autumn-thresh-sunning',
    verse: '新筑场泥镜面平，家家打稻趁霜晴。',
    seal: '霜晴打稻',
    matchRegions: ['东皋晒秋坪', '良田', '桃源村'],
    matchPhenology: ['autumn'],
    matchTime: ['day'],
    matchWeather: ['clear'],
    matchTags: ['sunning', 'millet', 'field', 'village'],
    priority: 2.3
  },
  {
    id: 'autumn-millet-dusk',
    verse: '金浪翻秋陌，斜阳照晚禾。',
    seal: '金浪晚照',
    matchRegions: ['良田', '北麓望稼楼', '北山层梯'],
    matchPhenology: ['autumn'],
    matchTime: ['dusk'],
    matchTags: ['millet', 'field', 'sunset', 'watchtower'],
    priority: 2.1
  },
  {
    id: 'winter-stubble-field',
    verse: '冬田留残茬，寒霜卧老牛。',
    seal: '冬田寒卧',
    matchRegions: ['良田', '阡陌'],
    matchPhenology: ['winter'],
    matchTime: ['day', 'dawn', 'dusk'],
    matchTags: ['field', 'ox', 'snow']
  },
  {
    id: 'rainy-paddy-frogs',
    verse: '黄梅时节家家雨，青草池塘处处蛙。',
    seal: '池塘青蛙',
    matchRegions: ['良田', '美池', '桃源村'],
    matchPhenology: ['summer', 'spring'],
    matchWeather: ['rain', 'mist'],
    matchTags: ['rain', 'pond', 'paddy']
  },

  // ---- 4. 武陵溪 · 渔舟 · 渡口 · 溪桥 · 芦苇（22条） ----
  {
    id: 'wuling-wangwei-peach-ferry',
    verse: '渔舟逐水爱山春，两岸桃花夹古津。',
    seal: '桃津渔舟',
    matchRegions: ['武陵溪', '桃花林'],
    matchPhenology: ['spring'],
    matchTime: ['day', 'dawn'],
    matchTags: ['stream', 'boat', 'peach', 'skiff-aboard'],
    priority: 2.0
  },
  {
    id: 'wuling-wangwei-red-trees',
    verse: '坐看红树不知远，行尽青溪不见人。',
    seal: '青溪红树',
    matchRegions: ['武陵溪', '桃花林', '水源'],
    matchPhenology: ['spring', 'autumn'],
    matchTags: ['stream', 'peach', 'boat', 'mountains']
  },
  {
    id: 'wuling-zhangxu-bridge',
    verse: '隐隐飞桥隔野烟，石矶西畔问渔船。',
    seal: '野烟渔船',
    matchRegions: ['武陵溪', '水源'],
    matchWeather: ['mist', 'clear'],
    matchTags: ['stream', 'boat', 'bridge', 'mist-sea']
  },
  {
    id: 'wuling-zhangxu-petals',
    verse: '桃花尽日随流水，洞在清溪何处边。',
    seal: '流水落花',
    matchRegions: ['武陵溪', '桃花林', '水源', '山口'],
    matchPhenology: ['spring'],
    matchTags: ['stream', 'peach', 'petals', 'cave'],
    priority: 1.8
  },
  {
    id: 'wuling-boat-light-wind',
    verse: '舟遥遥以轻飏，风飘飘而吹衣。',
    seal: '轻舟随风',
    matchRegions: ['武陵溪', '桃花林', '水源'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['skiff-aboard', 'skiff-drifting', 'boat', 'stream', 'wind'],
    priority: 2.4
  },
  {
    id: 'wuling-skiff-rain',
    verse: '青箬笠，绿蓑衣，斜风细雨不须归。',
    seal: '烟雨渔歌',
    matchRegions: ['武陵溪', '美池'],
    matchWeather: ['rain', 'mist'],
    avoidPhenology: ['winter'],
    matchTags: ['skiff-aboard', 'boat', 'rain', 'stream', 'wind'],
    priority: 2.7
  },
  {
    id: 'wuling-skiff-rain-sleep',
    verse: '春水碧于天，画船听雨眠。',
    seal: '船听春雨',
    matchRegions: ['武陵溪'],
    matchPhenology: ['spring', 'summer'],
    matchWeather: ['rain'],
    matchTags: ['skiff-aboard', 'skiff-drifting', 'boat', 'rain', 'stream'],
    priority: 2.8
  },
  {
    id: 'wuling-skiff-star-river',
    verse: '醉后不知天在水，满船清梦压星河。',
    seal: '清梦星河',
    matchRegions: ['武陵溪', '美池'],
    matchTime: ['night'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['skiff-aboard', 'boat', 'stars', 'milky-way', 'stream'],
    priority: 3.0
  },
  {
    id: 'wuling-skiff-night-lantern',
    verse: '月黑见渔灯，孤光一点萤。微微风簇浪，散作满河星。',
    seal: '渔灯散星',
    matchRegions: ['武陵溪', '水源'],
    matchTime: ['night'],
    matchTags: ['skiff-aboard', 'boat', 'ferry', 'stream', 'stars'],
    priority: 2.6
  },
  {
    id: 'wuling-skiff-drift-cloud',
    verse: '风烟俱净，天山共色。从流飘荡，任意东西。',
    seal: '从流飘荡',
    matchRegions: ['武陵溪', '水源'],
    matchWeather: ['clear'],
    matchTags: ['skiff-drifting', 'skiff-aboard', 'stream', 'mountains'],
    priority: 2.7
  },
  {
    id: 'wuling-wild-ferry',
    verse: '春潮带雨晚来急，野渡无人舟自横。',
    seal: '野渡横舟',
    matchRegions: ['武陵溪', '水源'],
    matchPhenology: ['spring', 'summer', 'autumn'],
    matchWeather: ['rain', 'mist', 'clear'],
    matchTime: ['dusk', 'day'],
    matchTags: ['boat', 'ferry', 'stream', 'rain'],
    priority: 2.0
  },
  {
    id: 'wuling-dusk-crossing',
    verse: '孤舟横野渡，落日映清溪。',
    seal: '孤舟晚渡',
    matchRegions: ['武陵溪', '水源'],
    matchTime: ['dusk'],
    matchTags: ['boat', 'ferry', 'stream', 'sunset']
  },
  {
    id: 'wuling-egret-shallow',
    verse: '浅滩立白鹭，清波映疏芦。',
    seal: '浅滩白鹭',
    matchRegions: ['武陵溪', '水源'],
    matchTime: ['day', 'dawn', 'dusk'],
    matchTags: ['egret', 'stream', 'ferry'],
    priority: 2.0
  },
  {
    id: 'wuling-clear-water-moss',
    verse: '漾漾泛菱荇，澄澄映葭苇。',
    seal: '清溪葭苇',
    matchRegions: ['武陵溪', '水源'],
    matchPhenology: ['spring', 'summer', 'autumn'],
    matchTags: ['stream', 'boat']
  },
  {
    id: 'wuling-quiet-heart',
    verse: '我心素已闲，清川澹如此。',
    seal: '清川澹然',
    matchRegions: ['武陵溪', '水源', '北涧三叠泉'],
    matchTags: ['stream', 'pond', 'skiff-drifting']
  },
  {
    id: 'wuling-rapid-stone',
    verse: '急湍甚箭，猛浪若奔。泉水激石，泠泠作响。',
    seal: '激石泠泠',
    matchRegions: ['武陵溪', '水源', '北涧三叠泉'],
    matchTags: ['stream', 'waterfall']
  },
  {
    id: 'wuling-autumn-reeds',
    verse: '蒹葭苍苍，白露为霜。所谓伊人，在水一方。',
    seal: '蒹葭白露',
    matchRegions: ['武陵溪', '美池'],
    matchPhenology: ['autumn'],
    matchTime: ['dawn', 'dusk', 'day'],
    matchTags: ['stream', 'pond', 'mist-sea'],
    priority: 2.0
  },
  {
    id: 'wuling-winter-snow-boat',
    verse: '千山鸟飞绝，万径人踪灭。孤舟蓑笠翁，独钓寒溪雪。',
    seal: '孤舟寒雪',
    matchRegions: ['武陵溪', '水源'],
    matchPhenology: ['winter'],
    matchWeather: ['snow'],
    matchTags: ['snow', 'boat', 'ferry', 'stream']
  },
  {
    id: 'wuling-winter-ice-shore',
    verse: '寒浅凝薄冰，素舸系清矶。',
    seal: '寒溪薄冰',
    matchRegions: ['武陵溪', '水源'],
    matchPhenology: ['winter'],
    matchTags: ['shore-ice', 'stream', 'ferry', 'boat'],
    priority: 2.1
  },
  {
    id: 'wuling-dawn-mist-skiff',
    verse: '晓雾迷轻楫，寒烟罩绿洲。',
    seal: '晓雾轻楫',
    matchRegions: ['武陵溪'],
    matchTime: ['dawn'],
    matchWeather: ['mist', 'clear'],
    matchTags: ['stream', 'boat', 'skiff-aboard', 'mist-sea']
  },
  {
    id: 'wuling-spring-source-source',
    verse: '春来遍是桃花水，不辨仙源何处寻。',
    seal: '仙源桃水',
    matchRegions: ['武陵溪', '桃花林', '水源'],
    matchPhenology: ['spring'],
    matchTags: ['stream', 'peach', 'petals', 'cave']
  },
  {
    id: 'wuling-log-bridge',
    verse: '杉木横清涧，步苔入幽林。',
    seal: '独木横涧',
    matchRegions: ['武陵溪', '东岭烂柯石枰', '北山层梯'],
    matchTags: ['bridge', 'stream', 'bamboo']
  },

  // ---- 5. 桃花林 · 落英春色 · 花雨芳草（16条） ----
  {
    id: 'peach-shijing',
    verse: '桃之夭夭，灼灼其华。',
    seal: '灼灼其华',
    matchRegions: ['桃花林', '西畴果林', '桃源村'],
    matchPhenology: ['spring'],
    avoidPhenology: ['winter'],
    matchTags: ['peach', 'petals']
  },
  {
    id: 'peach-breeze-petals',
    verse: '春风拂粉瓣，溪岸落英红。',
    seal: '风拂落英',
    matchRegions: ['桃花林', '武陵溪'],
    matchPhenology: ['spring'],
    matchWeather: ['wind', 'clear'],
    matchTags: ['peach', 'petals', 'wind', 'stream'],
    priority: 1.7
  },
  {
    id: 'peach-dufu-spring-rain',
    verse: '好雨知时节，当春乃发生。随风潜入夜，润物细无声。',
    seal: '春夜喜雨',
    matchRegions: ['桃花林', '良田', '桃源村'],
    matchPhenology: ['spring'],
    matchWeather: ['rain'],
    matchTime: ['night', 'dawn'],
    matchTags: ['rain', 'peach', 'paddy'],
    priority: 2.2
  },
  {
    id: 'peach-spring-dawn-birds',
    verse: '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。',
    seal: '春晓落花',
    matchRegions: ['桃花林', '桃源村', '西畴果林'],
    matchPhenology: ['spring'],
    matchTime: ['dawn', 'day'],
    matchTags: ['peach', 'petals', 'bird', 'sunrise']
  },
  {
    id: 'peach-libai-wonder',
    verse: '桃花流水窅然去，别有天地非人间。',
    seal: '别有天地',
    matchRegions: ['桃花林', '武陵溪', '豁然开朗'],
    matchPhenology: ['spring', 'summer'],
    matchTags: ['peach', 'stream', 'petals', 'mountains'],
    priority: 1.8
  },
  {
    id: 'peach-libai-smile',
    verse: '问余何意栖碧山，笑而不答心自闲。',
    seal: '笑栖碧山',
    matchRegions: ['桃花林', '东皋观云亭', '西岭鹿柴望川台'],
    matchTags: ['mountains', 'peach', 'pine']
  },
  {
    id: 'peach-sushi-duck',
    verse: '竹外桃花三两枝，春溪水暖鸭先知。',
    seal: '春溪水暖',
    matchRegions: ['桃花林', '美池', '桃源村', '武陵溪'],
    matchPhenology: ['spring'],
    matchTime: ['day', 'dawn'],
    matchTags: ['peach', 'bamboo', 'duck', 'stream', 'pond'],
    priority: 2.0
  },
  {
    id: 'peach-spring-sun-swallow',
    verse: '迟日江山丽，春风花草香。泥融飞燕子，沙暖睡鸳鸯。',
    seal: '春风花香',
    matchRegions: ['桃花林', '武陵溪', '美池'],
    matchPhenology: ['spring'],
    matchTime: ['day'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['peach', 'bird', 'stream', 'wind']
  },
  {
    id: 'peach-spring-rain-apricot',
    verse: '沾衣欲湿杏花雨，吹面不寒杨柳风。',
    seal: '杏雨柳风',
    matchRegions: ['桃花林', '西畴果林', '桃源村'],
    matchPhenology: ['spring'],
    matchWeather: ['rain', 'mist', 'wind'],
    matchTags: ['peach', 'rain', 'wind', 'petals']
  },
  {
    id: 'peach-night-moon-fragrance',
    verse: '春山多胜事，赏玩夜忘归。掬水月在手，弄花香满衣。',
    seal: '掬水弄花',
    matchRegions: ['桃花林', '美池', '水源'],
    matchPhenology: ['spring'],
    matchTime: ['night'],
    matchTags: ['peach', 'moon', 'stream', 'pond']
  },
  {
    id: 'peach-dawn-mist-grove',
    verse: '烟霭笼红树，芳草带露鲜。',
    seal: '烟霭桃林',
    matchRegions: ['桃花林', '水源'],
    matchPhenology: ['spring'],
    matchTime: ['dawn'],
    matchWeather: ['mist', 'clear'],
    matchTags: ['peach', 'mist-sea', 'sunrise']
  },
  {
    id: 'peach-tallies-wind',
    verse: '老桃悬木牌，山风鸣清磬。',
    seal: '桃枝祈岁',
    matchRegions: ['桃花林', '桃源村', '豁然开朗'],
    matchPhenology: ['spring', 'summer', 'autumn'],
    matchWeather: ['wind', 'clear'],
    matchTags: ['peach', 'wind', 'social-tree']
  },
  {
    id: 'peach-dusk-petals',
    verse: '夕阳铺水红，桃瓣逐波轻。',
    seal: '夕照飞花',
    matchRegions: ['桃花林', '武陵溪'],
    matchPhenology: ['spring'],
    matchTime: ['dusk'],
    matchTags: ['peach', 'petals', 'stream', 'sunset']
  },
  {
    id: 'peach-zhuxi-spring',
    verse: '等闲识得东风面，万紫千红总是春。',
    seal: '东风万紫',
    matchRegions: ['桃花林', '西畴果林'],
    matchPhenology: ['spring'],
    matchTime: ['day'],
    matchTags: ['peach', 'wind']
  },
  {
    id: 'peach-chenghao-noon',
    verse: '云淡风轻近午天，傍花随柳过前川。',
    seal: '傍花过川',
    matchRegions: ['桃花林', '武陵溪', '良田'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['peach', 'stream', 'clouds', 'wind']
  },
  {
    id: 'peach-rain-petal-wet',
    verse: '雨打芳林暗香动，落英贴石红满蹊。',
    seal: '雨打芳林',
    matchRegions: ['桃花林', '水源'],
    matchPhenology: ['spring'],
    matchWeather: ['rain'],
    matchTags: ['peach', 'petals', 'rain']
  },

  // ---- 6. 山有小口 · 初极狭 · 豁然开朗 · 迎客松 · 施茶寮（14条） ----
  {
    id: 'cave-wangwei-narrow',
    verse: '山口潜行始隈隩，山开旷望旋平陆。',
    seal: '山口初开',
    matchRegions: ['山口', '初极狭', '豁然开朗'],
    matchTags: ['cave', 'field', 'mountains'],
    priority: 2.3
  },
  {
    id: 'cave-luyou-village',
    verse: '山重水复疑无路，柳暗花明又一村。',
    seal: '柳暗花明',
    matchRegions: ['山口', '初极狭', '豁然开朗', '桃源村'],
    matchTags: ['cave', 'village', 'mountains', 'peach'],
    priority: 2.2
  },
  {
    id: 'cave-light-ahead',
    verse: '石壁夹青天，幽微一线光。',
    seal: '一线微光',
    matchRegions: ['初极狭', '山口'],
    matchTags: ['cave'],
    priority: 2.4
  },
  {
    id: 'cave-outskirt-pine',
    verse: '苍松立谷口，千载揖清风。',
    seal: '谷口迎客',
    matchRegions: ['豁然开朗', '山口'],
    matchTags: ['pine', 'cave', 'mountains'],
    priority: 1.9
  },
  {
    id: 'cave-outskirt-tea',
    verse: '才出幽岩口，茅寮煮暖茶。',
    seal: '谷口施茶',
    matchRegions: ['豁然开朗'],
    matchTags: ['tea-hut', 'cottage', 'cave'],
    priority: 2.1
  },
  {
    id: 'cave-source-mist',
    verse: '溪穷林亦尽，山腹吐轻岚。',
    seal: '水源山岚',
    matchRegions: ['水源', '山口'],
    matchWeather: ['mist', 'clear'],
    matchTags: ['cave', 'stream', 'mist-sea']
  },
  {
    id: 'cave-wangwei-deep',
    verse: '当时只记入山深，青溪几度到云林。',
    seal: '入山云林',
    matchRegions: ['水源', '山口', '桃花林'],
    matchTags: ['stream', 'cave', 'mountains', 'clouds']
  },
  {
    id: 'cave-wangwei-gorge',
    verse: '峡里谁知有人事，世中遥望空云山。',
    seal: '空望云山',
    matchRegions: ['初极狭', '山口', '东皋观云亭'],
    matchTags: ['cave', 'mountains', 'clouds']
  },
  {
    id: 'cave-dawn-gleam',
    verse: '晨光透石罅，一径入仙源。',
    seal: '晨光石罅',
    matchRegions: ['山口', '初极狭', '豁然开朗'],
    matchTime: ['dawn'],
    matchTags: ['cave', 'sunrise']
  },
  {
    id: 'cave-dusk-lantern',
    verse: '暮色隐石关，草寮灯火迎。',
    seal: '暮色草寮',
    matchRegions: ['豁然开朗', '山口'],
    matchTime: ['dusk', 'night'],
    matchTags: ['tea-hut', 'warm-lights', 'cave']
  },
  {
    id: 'cave-winter-pine-snow',
    verse: '老松负雪立山口，暖瓮姜烟迎远客。',
    seal: '松雪迎客',
    matchRegions: ['豁然开朗'],
    matchPhenology: ['winter'],
    matchTags: ['pine', 'tea-hut', 'snow', 'smoke'],
    priority: 2.4
  },
  {
    id: 'cave-moss-steps',
    verse: '青苔封石隙，流水伴行踪。',
    seal: '苔石伴行',
    matchRegions: ['山口', '初极狭', '水源'],
    matchTags: ['cave', 'stream']
  },
  {
    id: 'cave-rain-mist',
    verse: '岩门垂雨帘，谷外已春深。',
    seal: '岩门雨帘',
    matchRegions: ['山口', '初极狭', '豁然开朗'],
    matchWeather: ['rain', 'mist'],
    matchTags: ['cave', 'rain', 'mist-sea']
  },
  {
    id: 'cave-hidden-horizon',
    verse: '出洞平畴阔，桑麻入望青。',
    seal: '平畴入望',
    matchRegions: ['豁然开朗', '良田'],
    matchPhenology: ['spring', 'summer'],
    matchTags: ['field', 'mulberry', 'cave']
  },

  // ---- 7. 美池 · 荷塘 · 鲤鱼蜻蜓 · 浣衣 · 枯荷（18条） ----
  {
    id: 'pond-yangwanli-buds',
    verse: '小荷才露尖尖角，早有蜻蜓立上头。',
    seal: '小荷蜻蜓',
    matchRegions: ['美池', '芳池'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['day', 'dawn'],
    matchTags: ['lotus', 'dragonfly', 'pond'],
    priority: 2.4
  },
  {
    id: 'pond-yangwanli-spring',
    verse: '泉眼无声惜细流，树阴照水爱晴柔。',
    seal: '晴柔池影',
    matchRegions: ['美池', '水源', '竹坞药庐'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['day'],
    matchWeather: ['clear'],
    matchTags: ['pond', 'lotus', 'stream']
  },
  {
    id: 'pond-yangwanli-full-lotus',
    verse: '接天莲叶无穷碧，映日荷花别样红。',
    seal: '荷花映日',
    matchRegions: ['美池'],
    matchPhenology: ['summer'],
    matchTime: ['day', 'dawn'],
    matchWeather: ['clear'],
    matchTags: ['lotus', 'pond', 'sunrise'],
    priority: 2.3
  },
  {
    id: 'pond-menghaoran-fragrance',
    verse: '荷风送香气，竹露滴清响。',
    seal: '荷风竹露',
    matchRegions: ['美池', '六博亭林', '桑竹'],
    matchPhenology: ['summer'],
    matchTime: ['dusk', 'night', 'dawn'],
    matchTags: ['lotus', 'pond', 'bamboo', 'wind'],
    priority: 2.2
  },
  {
    id: 'pond-wangwei-wash-lotus',
    verse: '竹喧归浣女，莲动下渔舟。',
    seal: '竹喧莲动',
    matchRegions: ['美池', '六博亭林', '桑竹'],
    matchPhenology: ['summer'],
    matchTime: ['dusk', 'day'],
    matchTags: ['lotus', 'pond', 'bamboo', 'boat', 'villagers'],
    priority: 2.1
  },
  {
    id: 'pond-gaopian-summer',
    verse: '绿树阴浓夏日长，楼台倒影入池塘。',
    seal: '绿阴池影',
    matchRegions: ['美池', '桃源村', '六博亭林'],
    matchPhenology: ['summer'],
    matchTime: ['day'],
    matchTags: ['pond', 'pavilion', 'cottage', 'lotus']
  },
  {
    id: 'pond-lichongyuan-rain-lotus',
    verse: '风蒲猎猎小池塘，过雨荷花满院香。',
    seal: '雨荷清香',
    matchRegions: ['美池', '桃源村'],
    matchPhenology: ['summer'],
    matchWeather: ['rain', 'wind'],
    matchTags: ['lotus', 'pond', 'rain', 'wind'],
    priority: 2.2
  },
  {
    id: 'pond-zhuxi-mirror',
    verse: '半亩方塘一鉴开，天光云影共徘徊。',
    seal: '天光云影',
    matchRegions: ['美池'],
    matchWeather: ['clear', 'mist'],
    matchTime: ['day', 'dawn', 'dusk'],
    matchTags: ['pond', 'clouds']
  },
  {
    id: 'pond-zhuxi-living-water',
    verse: '问渠那得清如许，为有源头活水来。',
    seal: '源头活水',
    matchRegions: ['美池', '水源', '北涧三叠泉'],
    matchTags: ['pond', 'stream', 'waterfall']
  },
  {
    id: 'pond-libai-bamboo-lotus',
    verse: '竹色溪下绿，荷花镜里香。',
    seal: '镜里荷香',
    matchRegions: ['美池', '桑竹'],
    matchPhenology: ['summer'],
    matchTags: ['lotus', 'bamboo', 'pond']
  },
  {
    id: 'pond-carp-duckweed',
    verse: '浮萍开绿隙，锦鲤戏清波。',
    seal: '锦鲤浮萍',
    matchRegions: ['美池'],
    matchPhenology: ['spring', 'summer', 'autumn'],
    matchTags: ['fish', 'pond', 'duck']
  },
  {
    id: 'pond-moon-shadow',
    verse: '山光忽西落，池月渐东上。散发乘夕凉，开轩卧闲敞。',
    seal: '池月乘凉',
    matchRegions: ['美池', '六博亭林'],
    matchPhenology: ['summer', 'autumn'],
    matchTime: ['dusk', 'night'],
    matchTags: ['pond', 'moon', 'pavilion']
  },
  {
    id: 'pond-moon-cloud',
    verse: '沙上并禽池上瞑，云破月来花弄影。',
    seal: '云破月来',
    matchRegions: ['美池'],
    matchTime: ['night'],
    matchTags: ['pond', 'moon', 'clouds', 'duck']
  },
  {
    id: 'pond-autumn-lotus',
    verse: '采莲南塘秋，莲花过人头。',
    seal: '南塘采莲',
    matchRegions: ['美池'],
    matchPhenology: ['autumn', 'summer'],
    matchTags: ['lotus', 'pond']
  },
  {
    id: 'pond-withered-lotus',
    verse: '荷尽已无擎雨盖，菊残犹有傲霜枝。',
    seal: '枯荷傲霜',
    matchRegions: ['美池'],
    matchPhenology: ['winter', 'autumn'],
    matchTags: ['withered-lotus', 'pond', 'snow'],
    priority: 2.0
  },
  {
    id: 'pond-rain-lotus-pearls',
    verse: '碎雨敲青盖，圆珠滚碧盘。',
    seal: '雨打青盘',
    matchRegions: ['美池'],
    matchPhenology: ['summer'],
    matchWeather: ['rain'],
    matchTags: ['lotus', 'pond', 'rain']
  },
  {
    id: 'pond-laundry-stone',
    verse: '青石砧声响，清漪漾晨衣。',
    seal: '青石浣衣',
    matchRegions: ['美池', '桃源村'],
    matchTime: ['day', 'dawn'],
    matchTags: ['pond', 'villagers']
  },
  {
    id: 'pond-night-firefly-mirror',
    verse: '池萍浮星汉，流萤照水波。',
    seal: '池影流萤',
    matchRegions: ['美池'],
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchTags: ['pond', 'fireflies', 'stars', 'lotus'],
    priority: 2.4
  },

  // ---- 8. 桑竹 · 六博亭林 · 筒车水碓 · 村亭古树（18条） ----
  {
    id: 'bamboo-wangwei-grove',
    verse: '独坐幽篁里，弹琴复长啸。深林人不知，明月来相照。',
    seal: '幽篁琴月',
    matchRegions: ['桑竹', '六博亭林', '竹坞药庐'],
    matchTime: ['night', 'dusk'],
    matchTags: ['bamboo', 'moon', 'guqin', 'pavilion'],
    priority: 2.0
  },
  {
    id: 'bamboo-pavilion-liubo',
    verse: '竹阴覆石枰，闲坐听荷风。',
    seal: '竹阴六博',
    matchRegions: ['六博亭林', '桑竹', '美池'],
    matchPhenology: ['summer', 'spring'],
    matchTags: ['pavilion', 'liubo', 'bamboo', 'lotus', 'pond'],
    priority: 2.3
  },
  {
    id: 'bamboo-rain-pavilion',
    verse: '雨敲茅亭静，风过修竹寒。',
    seal: '竹亭听雨',
    matchRegions: ['六博亭林', '桑竹', '东皋观云亭', '北岭松风茶寮'],
    matchWeather: ['rain'],
    matchTags: ['pavilion', 'bamboo', 'rain'],
    priority: 2.0
  },
  {
    id: 'bamboo-spring-shoots',
    verse: '春雨润苔石，新笋破青泥。',
    seal: '春笋破泥',
    matchRegions: ['桑竹', '竹坞药庐', '六博亭林'],
    matchPhenology: ['spring'],
    matchWeather: ['rain', 'clear'],
    matchTags: ['bamboo', 'rain']
  },
  {
    id: 'bamboo-night-cicada',
    verse: '修篁栖晚照，微风过碧竿。',
    seal: '修篁晚照',
    matchRegions: ['桑竹', '六博亭林'],
    matchTime: ['dusk', 'day'],
    matchTags: ['bamboo', 'wind', 'sunset']
  },
  {
    id: 'bamboo-winter-jade',
    verse: '寒竹犹青翠，霜枝立暮鸦。',
    seal: '岁寒青竹',
    matchRegions: ['桑竹', '竹坞药庐'],
    matchPhenology: ['winter', 'autumn'],
    matchTags: ['bamboo', 'snow', 'bird']
  },
  {
    id: 'waterwheel-day-night',
    verse: '清渠引山泉，筒车昼夜转。',
    seal: '筒车流泉',
    matchRegions: ['筒车水碓', '良田'],
    matchTags: ['waterwheel', 'water-mortar', 'stream'],
    priority: 2.6
  },
  {
    id: 'waterwheel-mortar-sound',
    verse: '溪轮汲清波，水碓舂新谷。',
    seal: '水碓舂谷',
    matchRegions: ['筒车水碓', '桃源村'],
    matchTags: ['waterwheel', 'water-mortar', 'stream', 'millet'],
    priority: 2.4
  },
  {
    id: 'waterwheel-irrigation',
    verse: '剖竹连山溜，欢声过稻田。',
    seal: '竹槽引水',
    matchRegions: ['筒车水碓', '良田'],
    matchPhenology: ['spring', 'summer'],
    matchTags: ['waterwheel', 'paddy', 'bamboo']
  },
  {
    id: 'mulberry-children-gourd',
    verse: '童孙未解供耕织，也傍桑阴学种瓜。',
    seal: '桑阴种瓜',
    matchRegions: ['桑竹', '桃源村', '人家'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['day'],
    avoidTime: ['night'],
    matchTags: ['mulberry', 'children', 'field', 'village']
  },
  {
    id: 'mulberry-silkworm-spring',
    verse: '绿桑拂暖日，采叶满竹筐。',
    seal: '春桑盈筐',
    matchRegions: ['桑竹', '桃源村'],
    matchPhenology: ['spring'],
    matchTime: ['day'],
    matchTags: ['mulberry', 'villagers']
  },
  {
    id: 'social-tree-camphor',
    verse: '古樟荫广陌，树下聚童翁。',
    seal: '古社闲话',
    matchRegions: ['桃源村', '人家'],
    matchTime: ['day', 'dusk'],
    matchTags: ['social-tree', 'elders', 'children', 'villagers'],
    priority: 1.8
  },
  {
    id: 'social-tree-wine-hollow',
    verse: '老根藏桃酿，清风透瓮香。',
    seal: '树洞桃酿',
    matchRegions: ['桃源村', '桃花林'],
    matchTags: ['social-tree', 'peach']
  },
  {
    id: 'liubo-stone-table',
    verse: '亭深竹影乱，对局投六箸。',
    seal: '茅亭对弈',
    matchRegions: ['六博亭林', '东岭烂柯石枰'],
    matchTime: ['day', 'dusk'],
    matchTags: ['liubo', 'pavilion', 'lanke-chess', 'bamboo'],
    priority: 2.1
  },
  {
    id: 'pavilion-summer-breeze',
    verse: '水晶帘动微风起，满架蔷薇一院香。',
    seal: '夏亭微风',
    matchRegions: ['六博亭林', '人家', '美池'],
    matchPhenology: ['summer'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['pavilion', 'wind', 'cottage']
  },
  {
    id: 'pavilion-night-moon',
    verse: '茅亭纳夜凉，竹影碎月光。',
    seal: '茅亭碎月',
    matchRegions: ['六博亭林', '东皋观云亭'],
    matchTime: ['night'],
    matchTags: ['pavilion', 'bamboo', 'moon', 'stars'],
    priority: 1.9
  },
  {
    id: 'bamboo-mist-grove',
    verse: '青雾缠翠竹，深坞不知尘。',
    seal: '雾竹幽坞',
    matchRegions: ['桑竹', '竹坞药庐'],
    matchWeather: ['mist', 'rain'],
    matchTags: ['bamboo', 'mist-sea']
  },
  {
    id: 'cottage-garden-swept',
    verse: '茅檐长扫净无苔，花木成畦手自栽。',
    seal: '茅檐花畦',
    matchRegions: ['人家', '桃源村', '竹坞药庐'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day'],
    matchTags: ['cottage', 'field', 'herbs']
  },

  // ---- 9. 桃源村 · 人家 · 炊烟暖灯 · 篝火夜宴 · 鸡犬童老（18条） ----
  {
    id: 'village-menghaoran-farmhouse',
    verse: '绿树村边合，青山郭外斜。开轩面场圃，把酒话桑麻。',
    seal: '把酒桑麻',
    matchRegions: ['桃源村', '人家', '东皋晒秋坪'],
    matchPhenology: ['spring', 'summer', 'autumn'],
    matchTime: ['day', 'dusk'],
    matchTags: ['village', 'cottage', 'mountains', 'field', 'sunning'],
    priority: 1.7
  },
  {
    id: 'village-wangwei-smoke-sunset',
    verse: '渡头余落日，墟里上孤烟。',
    seal: '落日孤烟',
    matchRegions: ['桃源村', '武陵溪', '人家'],
    matchTime: ['dusk'],
    matchTags: ['sunset', 'smoke', 'village', 'ferry', 'cottage'],
    priority: 1.9
  },
  {
    id: 'village-night-bonfire-feast',
    verse: '篝火映晒场，击缶歌太平。',
    seal: '夜阑缶歌',
    matchRegions: ['桃源村', '人家'],
    matchTime: ['night'],
    matchTags: ['bonfire', 'feast', 'village', 'warm-lights'],
    priority: 2.6
  },
  {
    id: 'village-luyou-feast',
    verse: '莫笑农家腊酒浑，丰年留客足鸡豚。',
    seal: '丰年留客',
    matchRegions: ['桃源村', '人家'],
    matchPhenology: ['autumn', 'winter'],
    matchTags: ['feast', 'chicken', 'village', 'bonfire']
  },
  {
    id: 'village-luyou-moon-visit',
    verse: '从今若许闲乘月，拄杖无时夜叩门。',
    seal: '乘月夜访',
    matchRegions: ['人家', '桃源村'],
    matchTime: ['night'],
    matchTags: ['moon', 'cottage', 'warm-lights', 'elders'],
    priority: 1.8
  },
  {
    id: 'village-tao-candle',
    verse: '日入室中暗，荆薪代明烛。',
    seal: '夜室荆烛',
    matchRegions: ['人家', '桃源村', '西岭云樵茅舍'],
    matchTime: ['night', 'dusk'],
    matchTags: ['cottage', 'warm-lights', 'bonfire']
  },
  {
    id: 'village-warm-window-night',
    verse: '暮云归深谷，茅窗透灯温。',
    seal: '茅窗暖灯',
    matchRegions: ['桃源村', '人家', '良田'],
    matchTime: ['night', 'dusk'],
    matchTags: ['warm-lights', 'cottage', 'village', 'mountains'],
    priority: 2.1
  },
  {
    id: 'village-morning-smoke',
    verse: '晨鸡啼竹院，瓦屋起青烟。',
    seal: '晓院青烟',
    matchRegions: ['桃源村', '人家'],
    matchTime: ['dawn'],
    matchTags: ['smoke', 'chicken', 'cottage', 'sunrise', 'bamboo'],
    priority: 2.0
  },
  {
    id: 'village-jiao-welcome',
    verse: '载欣载奔，僮仆欢迎，稚子候门。',
    seal: '稚子候门',
    matchRegions: ['人家', '桃源村'],
    matchTime: ['day', 'dusk'],
    matchTags: ['children', 'cottage', 'village']
  },
  {
    id: 'village-fanchengda-dragonfly',
    verse: '日长篱落无人过，惟有蜻蜓蛱蝶飞。',
    seal: '日长篱落',
    matchRegions: ['人家', '桃源村', '良田'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['day'],
    matchTags: ['cottage', 'dragonfly', 'field']
  },
  {
    id: 'village-fanchengda-apricot',
    verse: '梅子金黄杏子肥，麦花雪白菜花稀。',
    seal: '梅黄麦雪',
    matchRegions: ['良田', '西畴果林', '人家'],
    matchPhenology: ['summer'],
    matchTime: ['day'],
    matchTags: ['field', 'cottage']
  },
  {
    id: 'village-xinqiji-low-eaves',
    verse: '茅檐低小，溪上青青草。',
    seal: '茅檐青草',
    matchRegions: ['人家', '桃源村', '武陵溪'],
    matchPhenology: ['spring', 'summer'],
    matchTags: ['cottage', 'stream']
  },
  {
    id: 'village-xinqiji-lotus-boy',
    verse: '最喜小儿亡赖，溪头卧剥莲蓬。',
    seal: '溪头剥莲',
    matchRegions: ['美池', '桃源村', '人家'],
    matchPhenology: ['summer'],
    matchTime: ['day'],
    matchTags: ['children', 'lotus', 'pond']
  },
  {
    id: 'village-winter-stove',
    verse: '绿蚁新醅酒，红泥小火炉。',
    seal: '红泥火炉',
    matchRegions: ['人家', '桃源村', '北岭松风茶寮'],
    matchPhenology: ['winter', 'autumn'],
    matchTime: ['night', 'dusk'],
    matchTags: ['cottage', 'warm-lights', 'bonfire', 'snow'],
    priority: 2.0
  },
  {
    id: 'village-winter-snow-ask',
    verse: '晚来天欲雪，能饮一杯无。',
    seal: '欲雪一杯',
    matchRegions: ['人家', '桃源村'],
    matchPhenology: ['winter'],
    matchTime: ['dusk', 'night'],
    matchTags: ['snow', 'cottage', 'warm-lights', 'feast']
  },
  {
    id: 'village-snow-dog-bark',
    verse: '柴门闻犬吠，风雪夜归人。',
    seal: '风雪归人',
    matchRegions: ['人家', '西岭云樵茅舍', '桃源村'],
    matchPhenology: ['winter'],
    matchWeather: ['snow', 'wind'],
    matchTime: ['night', 'dusk'],
    matchTags: ['snow', 'dog', 'cottage', 'warm-lights'],
    priority: 2.3
  },
  {
    id: 'village-luyou-ancient-custom',
    verse: '箫鼓追随春社近，衣冠简朴古风存。',
    seal: '古风春社',
    matchRegions: ['桃源村', '人家'],
    matchPhenology: ['spring'],
    matchTags: ['social-tree', 'villagers', 'village']
  },
  {
    id: 'village-tao-chicken-wine',
    verse: '漉我新熟酒，只鸡招近局。',
    seal: '新酒近局',
    matchRegions: ['人家', '桃源村'],
    matchTags: ['feast', 'chicken', 'cottage']
  },

  // ---- 10. 谷缘与外野秘境全覆盖（26条） ----
  {
    id: 'exp-cloud-pavilion',
    verse: '登高望云海，松风拂衣袂。',
    seal: '东皋观云',
    matchRegions: ['东皋观云亭'],
    matchTags: ['cloud-pavilion', 'clouds', 'mist-sea', 'pine', 'mountains'],
    priority: 2.5
  },
  {
    id: 'exp-cloud-pavilion-overlook',
    verse: '六柱亭前开画卷，一谷桑麻入烟云。',
    seal: '凭栏望谷',
    matchRegions: ['东皋观云亭', '西岭鹿柴望川台'],
    matchTags: ['cloud-pavilion', 'mountains', 'village', 'clouds'],
    priority: 2.0
  },
  {
    id: 'exp-sunning-terrace',
    verse: '晴坪晒金粟，秋阳染红椒。',
    seal: '东皋晒秋',
    matchRegions: ['东皋晒秋坪'],
    matchPhenology: ['autumn', 'summer'],
    matchTags: ['sunning', 'millet'],
    priority: 2.5
  },
  {
    id: 'exp-east-pasture',
    verse: '天苍苍，野茫茫，风吹草低见牛羊。',
    seal: '东皋牧羊',
    matchRegions: ['东皋牧羊坡'],
    matchTags: ['goat', 'ox', 'field', 'wind'],
    priority: 2.6
  },
  {
    id: 'exp-east-pasture-lamb',
    verse: '白羊散晴坡，闲卧看云移。',
    seal: '晴坡白羊',
    matchRegions: ['东皋牧羊坡'],
    matchTime: ['day', 'dawn', 'dusk'],
    matchTags: ['goat', 'clouds'],
    priority: 2.2
  },
  {
    id: 'exp-ancient-stele',
    verse: '古碑横青苔，残字记避秦。',
    seal: '避秦残碑',
    matchRegions: ['避秦残碑'],
    matchTags: ['ancient-stele', 'pine'],
    priority: 2.7
  },
  {
    id: 'exp-north-terraces',
    verse: '层畴依北麓，曲水映天光。',
    seal: '北山层梯',
    matchRegions: ['北山层梯'],
    matchTags: ['terrace', 'paddy', 'field'],
    priority: 2.5
  },
  {
    id: 'exp-north-terraces-clouds',
    verse: '梯田叠翠接云梯，一镜澄波分晓霞。',
    seal: '层梯云镜',
    matchRegions: ['北山层梯'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['dawn', 'dusk', 'day'],
    matchTags: ['terrace', 'paddy', 'sunrise', 'sunset', 'clouds']
  },
  {
    id: 'exp-three-tier-waterfall',
    verse: '飞泉落三叠，漱玉入澄潭。',
    seal: '飞瀑三叠',
    matchRegions: ['北涧三叠泉'],
    matchTags: ['waterfall', 'stream'],
    priority: 2.7
  },
  {
    id: 'exp-waterfall-libai',
    verse: '飞流直下三千尺，疑是银河落九天。',
    seal: '银河飞瀑',
    matchRegions: ['北涧三叠泉'],
    matchTags: ['waterfall'],
    priority: 2.2
  },
  {
    id: 'exp-waterfall-wangwei',
    verse: '山中一夜雨，树杪百重泉。',
    seal: '百重山泉',
    matchRegions: ['北涧三叠泉', '竹坞药庐'],
    matchWeather: ['rain', 'mist', 'clear'],
    matchTags: ['waterfall', 'rain', 'mountains']
  },
  {
    id: 'exp-watchtower-harvest',
    verse: '望稼高楼外，千重稻浪平。',
    seal: '望稼高楼',
    matchRegions: ['北麓望稼楼'],
    matchTags: ['watchtower', 'field', 'millet', 'paddy'],
    priority: 2.5
  },
  {
    id: 'exp-herb-cottage',
    verse: '竹炉煎山泉，药香隐深坞。',
    seal: '竹坞药香',
    matchRegions: ['竹坞药庐'],
    matchTags: ['herbs', 'bamboo', 'tea-hut', 'cottage'],
    priority: 2.6
  },
  {
    id: 'exp-herb-jiadao',
    verse: '松下问童子，言师采药去。只在此山中，云深不知处。',
    seal: '云深采药',
    matchRegions: ['竹坞药庐', '北岭松风茶寮', '西岭云樵茅舍'],
    matchTags: ['herbs', 'pine', 'clouds', 'mist-sea', 'mountains'],
    priority: 2.1
  },
  {
    id: 'exp-pine-tea-hut',
    verse: '松风绕茶寮，瓦铫沸山泉。',
    seal: '松风茶寮',
    matchRegions: ['北岭松风茶寮'],
    matchTags: ['tea-hut', 'pine', 'smoke', 'wind'],
    priority: 2.7
  },
  {
    id: 'exp-tea-boil',
    verse: '松花酿酒，春水煎茶。',
    seal: '春水煎茶',
    matchRegions: ['北岭松风茶寮', '竹坞药庐', '豁然开朗'],
    matchTags: ['tea-hut', 'pine', 'stream']
  },
  {
    id: 'exp-ancient-kiln',
    verse: '古窑柴烟起，陶坯带山泥。',
    seal: '山阿古窑',
    matchRegions: ['山阿秦汉古窑'],
    matchTags: ['kiln', 'smoke'],
    priority: 2.7
  },
  {
    id: 'exp-lanke-chess',
    verse: '松阴落白子，山中不知年。',
    seal: '烂柯忘年',
    matchRegions: ['东岭烂柯石枰'],
    matchTags: ['lanke-chess', 'pine', 'liubo'],
    priority: 2.7
  },
  {
    id: 'exp-lanke-no-calendar',
    verse: '山中无历日，寒尽不知年。',
    seal: '山中忘年',
    matchRegions: ['东岭烂柯石枰', '竹坞药庐', '西岭云樵茅舍'],
    matchTags: ['lanke-chess', 'mountains', 'pine']
  },
  {
    id: 'exp-deer-hermitage',
    verse: '空山不见人，但闻人语响。返景入深林，复照青苔上。',
    seal: '空山鹿柴',
    matchRegions: ['西岭鹿柴望川台'],
    matchTime: ['dusk', 'day'],
    matchTags: ['hermitage', 'bamboo', 'stag', 'sunset'],
    priority: 2.6
  },
  {
    id: 'exp-deer-shijing',
    verse: '呦呦鹿鸣，食野之苹。我有嘉宾，鼓瑟吹笙。',
    seal: '呦鹿鸣苹',
    matchRegions: ['西岭鹿柴望川台'],
    matchTags: ['stag', 'hermitage', 'guqin', 'feast'],
    priority: 2.4
  },
  {
    id: 'exp-woodcutter-hut',
    verse: '山樵负薪归，云外一茅居。',
    seal: '云岭樵舍',
    matchRegions: ['西岭云樵茅舍'],
    matchTags: ['woodcutter-hut', 'cottage', 'pine', 'smoke'],
    priority: 2.6
  },
  {
    id: 'exp-west-orchard',
    verse: '梨雪压枝低，春深果木繁。',
    seal: '西畴果林',
    matchRegions: ['西畴果林'],
    matchPhenology: ['spring', 'summer', 'autumn'],
    matchTags: ['peach', 'field'],
    priority: 2.4
  },
  {
    id: 'exp-guqin-stone',
    verse: '松风吹解带，山月照弹琴。',
    seal: '山月素琴',
    matchRegions: ['东皋观云亭', '西岭鹿柴望川台', '六博亭林'],
    matchTime: ['night', 'dusk'],
    matchTags: ['guqin', 'pine', 'moon', 'wind'],
    priority: 2.5
  },
  {
    id: 'exp-white-stag',
    verse: '林深逢白鹿，回首饮清泉。',
    seal: '幽林白鹿',
    matchRegions: ['西岭鹿柴望川台', '东岭烂柯石枰', '竹坞药庐'],
    matchTags: ['stag', 'hermitage', 'stream'],
    priority: 2.6
  },
  {
    id: 'exp-bamboo-slips-cup',
    verse: '素简记农时，曲水浮羽觞。',
    seal: '曲水素简',
    matchRegions: ['桃源村', '竹坞药庐', '武陵溪'],
    matchTags: ['stream', 'ancient-stele', 'guqin']
  },
  {
    id: 'exp-log-bridge',
    verse: '劈杉横清涧，苔石漱寒泉。',
    seal: '独木山桥',
    matchRegions: ['东涧独木山桥'],
    matchTags: ['bridge', 'stream'],
    priority: 2.7
  },
  {
    id: 'exp-jade-tea-terrace',
    verse: '碧涧生茶雾，茅棚炒新芽。',
    seal: '碧涧茶坞',
    matchRegions: ['东南碧涧茶坞'],
    matchTags: ['tea-terrace', 'tea-hut', 'stream'],
    priority: 2.7
  },
  {
    id: 'exp-cold-spring-study',
    verse: '竹笕引冷泉，青简伴松涛。',
    seal: '冷泉幽轩',
    matchRegions: ['北涧冷泉幽轩'],
    matchTags: ['study', 'pine', 'stream'],
    priority: 2.7
  },
  {
    id: 'exp-ancient-qin-altar',
    verse: '古樟阴石坛，春祈千岁安。',
    seal: '避秦古社',
    matchRegions: ['西南古社避秦坛'],
    matchTags: ['altar', 'social-tree'],
    priority: 2.7
  },

  // ---- 11. 天象四时：星汉、望月、朝暮、烟雨、彩虹、南雁、冬雪（28条） ----
  {
    id: 'sky-night-stars-plain',
    verse: '星垂平野阔，月照静溪明。',
    seal: '星垂平野',
    matchTime: ['night'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['stars', 'milky-way', 'field', 'stream'],
    priority: 1.7
  },
  {
    id: 'sky-night-milkyway-silvery',
    verse: '暮云收尽溢清寒，银汉无声转玉盘。',
    seal: '银汉玉盘',
    matchPhenology: ['autumn', 'summer'],
    matchTime: ['night'],
    matchWeather: ['clear'],
    matchTags: ['milky-way', 'stars', 'full-moon', 'moon'],
    priority: 1.9
  },
  {
    id: 'sky-night-full-moon-east',
    verse: '白日沦西河，素月出东岭。',
    seal: '素月东岭',
    matchTime: ['night', 'dusk'],
    matchWeather: ['clear'],
    matchTags: ['moon', 'full-moon', 'mountains'],
    priority: 1.8
  },
  {
    id: 'sky-night-crescent-moon',
    verse: '一弯新月照溪村，几点流萤度竹篱。',
    seal: '新月流萤',
    matchPhenology: ['summer', 'spring'],
    matchTime: ['night'],
    matchWeather: ['clear'],
    matchTags: ['crescent-moon', 'moon', 'fireflies', 'bamboo', 'cottage'],
    priority: 2.2
  },
  {
    id: 'sky-night-wangwei-autumn-moon',
    verse: '空山新雨后，天气晚来秋。明月松间照，清泉石上流。',
    seal: '明月松泉',
    matchPhenology: ['autumn'],
    matchTime: ['night', 'dusk'],
    matchTags: ['moon', 'pine', 'stream', 'mountains'],
    priority: 2.2
  },
  {
    id: 'sky-night-yuliangshi-osmanthus',
    verse: '人闲桂花落，夜静春山空。月出惊山鸟，时鸣春涧中。',
    seal: '夜静山空',
    matchPhenology: ['spring', 'autumn'],
    matchTime: ['night'],
    matchTags: ['moon', 'mountains', 'bird', 'stream'],
    priority: 1.7
  },
  {
    id: 'sky-night-xinqiji-stars-rain',
    verse: '七八个星天外，两三点雨山前。',
    seal: '星外山雨',
    matchPhenology: ['summer', 'autumn'],
    matchTime: ['night'],
    matchTags: ['stars', 'rain', 'mountains'],
    priority: 1.8
  },
  {
    id: 'sky-night-dufu-four-watch',
    verse: '四更山吐月，残夜水明楼。',
    seal: '山月明水',
    matchTime: ['night', 'dawn'],
    matchWeather: ['clear'],
    matchTags: ['moon', 'mountains', 'pond', 'watchtower']
  },
  {
    id: 'sky-night-meteor-wish',
    verse: '微星划夜碧，清谷卧星河。',
    seal: '流光入汉',
    matchTime: ['night'],
    matchWeather: ['clear'],
    matchTags: ['stars', 'milky-way', 'skyward']
  },
  {
    id: 'sky-dawn-dew',
    verse: '晓风轻拂露，旭日照苍山。',
    seal: '晓日苍山',
    matchTime: ['dawn'],
    matchWeather: ['clear', 'mist'],
    matchTags: ['sunrise', 'mountains', 'mist-sea'],
    priority: 1.7
  },
  {
    id: 'sky-dawn-mist-village',
    verse: '平明烟未散，鸡犬隔林闻。',
    seal: '平明烟村',
    matchTime: ['dawn'],
    matchWeather: ['mist', 'clear'],
    matchTags: ['mist-sea', 'village', 'sunrise', 'smoke']
  },
  {
    id: 'sky-dusk-wangbo-sunset',
    verse: '落霞与孤鹜齐飞，秋水共长天一色。',
    seal: '落霞秋水',
    matchPhenology: ['autumn'],
    matchTime: ['dusk'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['sunset', 'pond', 'stream', 'bird', 'clouds'],
    priority: 2.3
  },
  {
    id: 'sky-dusk-wangji-east',
    verse: '树树皆秋色，山山唯落晖。',
    seal: '秋山落晖',
    matchPhenology: ['autumn'],
    matchTime: ['dusk'],
    matchTags: ['sunset', 'mountains', 'clouds'],
    priority: 2.2
  },
  {
    id: 'sky-dusk-cloud-glow',
    verse: '晚霞烧远岫，暮霭合平川。',
    seal: '晚霞远岫',
    matchTime: ['dusk'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['sunset', 'mountains', 'clouds'],
    priority: 1.8
  },
  {
    id: 'sky-post-rain-rainbow',
    verse: '新虹跨晴谷，青绿染山光。',
    seal: '雨霁飞虹',
    matchPhenology: ['spring', 'summer', 'autumn'],
    matchWeather: ['clear', 'mist'],
    matchTime: ['day', 'dawn', 'dusk'],
    requiresTag: 'rainbow',
    matchTags: ['rainbow', 'mountains', 'clouds', 'skyward'],
    priority: 4.0
  },
  {
    id: 'sky-post-rain-qinguang',
    verse: '一夕轻雷落万丝，霁光浮瓦碧参差。',
    seal: '雨霁浮光',
    matchPhenology: ['spring', 'summer'],
    matchWeather: ['clear', 'mist'],
    requiresTag: 'rainbow',
    matchTags: ['rainbow', 'cottage', 'village', 'clouds'],
    priority: 2.2
  },
  {
    id: 'sky-autumn-geese',
    verse: '碧云天外雁成字，秋谷风清稻穗黄。',
    seal: '秋雁行空',
    matchPhenology: ['autumn'],
    matchTime: ['day', 'dusk', 'dawn'],
    requiresTag: 'geese',
    matchTags: ['geese', 'skyward', 'millet', 'clouds'],
    priority: 3.8
  },
  {
    id: 'sky-autumn-liuyuxi-crane',
    verse: '山明水净夜来霜，数树深红出浅黄。',
    seal: '秋山霜红',
    matchPhenology: ['autumn'],
    matchTime: ['day', 'dawn'],
    matchTags: ['mountains', 'clouds', 'field'],
    priority: 1.9
  },
  {
    id: 'sky-rain-sushi',
    verse: '水光潋滟晴方好，山色空蒙雨亦奇。',
    seal: '水光山色',
    matchWeather: ['rain', 'mist', 'clear'],
    matchTags: ['rain', 'mist-sea', 'pond', 'mountains'],
    priority: 1.8
  },
  {
    id: 'sky-rain-calm',
    verse: '一蓑烟雨任平生，也无风雨也无晴。',
    seal: '烟雨平生',
    matchWeather: ['rain', 'mist', 'wind'],
    matchTags: ['rain', 'mist-sea', 'wind', 'skiff-aboard']
  },
  {
    id: 'sky-rain-night-quiet',
    verse: '雨中山果落，灯下草虫鸣。',
    seal: '雨夜虫鸣',
    matchPhenology: ['autumn', 'summer'],
    matchWeather: ['rain'],
    matchTime: ['night'],
    matchTags: ['rain', 'warm-lights', 'cottage'],
    priority: 2.2
  },
  {
    id: 'sky-mist-cloud-sea',
    verse: '山中何所有，岭上多白云。只可自怡悦，不堪持赠君。',
    seal: '岭上白云',
    matchWeather: ['mist', 'clear'],
    matchTags: ['clouds', 'mist-sea', 'mountains', 'cloud-pavilion'],
    priority: 1.9
  },
  {
    id: 'sky-mist-wet-clothes',
    verse: '纵使晴明无雨色，入云深处亦沾衣。',
    seal: '入云沾衣',
    matchWeather: ['mist'],
    matchTags: ['mist-sea', 'clouds', 'mountains']
  },
  {
    id: 'sky-wind-clear-water',
    verse: '清风徐来，水波不兴。',
    seal: '清风不兴',
    matchWeather: ['clear', 'wind'],
    matchTags: ['wind', 'pond', 'stream', 'skiff-drifting']
  },
  {
    id: 'sky-autumn-orange-green',
    verse: '一年好景君须记，正是橙黄橘绿时。',
    seal: '橙黄橘绿',
    matchPhenology: ['autumn'],
    matchTime: ['day'],
    matchTags: ['millet', 'sunning', 'mountains']
  },
  {
    id: 'sky-winter-snow-morning',
    verse: '晨起开门雪满山，雪晴云淡日光寒。',
    seal: '雪满晴山',
    matchPhenology: ['winter'],
    matchTime: ['dawn', 'day'],
    matchWeather: ['clear', 'snow'],
    matchTags: ['snow', 'mountains', 'cottage'],
    priority: 2.1
  },
  {
    id: 'sky-winter-four-seasons-pine',
    verse: '春水满四泽，夏云多奇峰。秋月扬明晖，冬岭秀寒松。',
    seal: '冬岭寒松',
    matchPhenology: ['winter', 'summer', 'autumn', 'spring'],
    matchTags: ['pine', 'mountains', 'clouds', 'moon']
  },
  {
    id: 'sky-winter-plum-snow',
    verse: '一树寒枝白玉条，迥临村路傍溪桥。',
    seal: '雪树溪桥',
    matchPhenology: ['winter'],
    matchWeather: ['snow', 'clear'],
    matchTags: ['snow', 'bridge', 'stream', 'cottage']
  },

  // ---- 12. 凌虚俯瞰 · 远山青绿 · 仰观天际（14条） ----
  {
    id: 'vantage-aerial-valley-scroll',
    verse: '凌虚俯碧谷，万顷入丹青。',
    seal: '凌虚俯览',
    matchTags: ['aerial', 'mountains', 'clouds', 'village'],
    priority: 2.6
  },
  {
    id: 'vantage-aerial-smoke-fields',
    verse: '云端望平畴，阡陌棋局分。',
    seal: '云端阡陌',
    matchTags: ['aerial', 'field', 'paddy', 'village'],
    priority: 2.5
  },
  {
    id: 'vantage-aerial-mist-peaks',
    verse: '层峦浮翠霭，一水绕村流。',
    seal: '层峦绕村',
    matchTags: ['aerial', 'mountains', 'stream', 'village', 'mist-sea'],
    priority: 2.4
  },
  {
    id: 'vantage-aerial-night-lamps',
    verse: '高览仙源夜，星河落万檐。',
    seal: '星落万檐',
    matchTime: ['night'],
    matchTags: ['aerial', 'stars', 'milky-way', 'warm-lights', 'village'],
    priority: 2.7
  },
  {
    id: 'vantage-aerial-winter-jade',
    verse: '俯瞰银装谷，炊烟一线温。',
    seal: '银谷炊烟',
    matchPhenology: ['winter'],
    matchTags: ['aerial', 'snow', 'smoke', 'village'],
    priority: 2.5
  },
  {
    id: 'vantage-skyward-cloud-peak',
    verse: '仰观白玉云，松翠接天青。',
    seal: '仰观云松',
    matchTime: ['day', 'dawn'],
    matchTags: ['skyward', 'clouds', 'pine', 'mountains'],
    priority: 2.1
  },
  {
    id: 'vantage-skyward-autumn-crisp',
    verse: '晴空一鹤排云上，便引诗情到碧霄。',
    seal: '碧霄诗情',
    matchPhenology: ['autumn'],
    matchTime: ['day'],
    matchTags: ['skyward', 'clouds', 'geese', 'bird'],
    priority: 2.2
  },
  {
    id: 'vantage-skyward-star-dome',
    verse: '仰首银河近，星辉满翠微。',
    seal: '仰首星河',
    matchTime: ['night'],
    matchWeather: ['clear'],
    matchTags: ['skyward', 'stars', 'milky-way'],
    priority: 2.4
  },
  {
    id: 'vantage-mountains-wangwei',
    verse: '行到水穷处，坐看云起时。偶然值林叟，谈笑无还期。',
    seal: '坐看云起',
    matchRegions: ['水源', '东皋观云亭', '北涧三叠泉', '西岭鹿柴望川台'],
    matchTags: ['clouds', 'mountains', 'stream', 'elders'],
    priority: 1.8
  },
  {
    id: 'vantage-mountains-distant-azure',
    verse: '远峰叠青黛，微岚抹翠腰。',
    seal: '青黛远峰',
    matchTime: ['day', 'dawn'],
    matchTags: ['mountains', 'clouds', 'mist-sea']
  },
  {
    id: 'vantage-mountains-stone-brook',
    verse: '声喧乱石中，色静深松里。',
    seal: '色静深松',
    matchRegions: ['北涧三叠泉', '北岭松风茶寮', '西岭云樵茅舍'],
    matchTags: ['pine', 'stream', 'waterfall']
  },
  {
    id: 'vantage-sunset-peak-still',
    verse: '苍山敛余晖，归鸟投暮林。',
    seal: '暮林归鸟',
    matchTime: ['dusk'],
    matchTags: ['mountains', 'sunset', 'bird']
  },
  {
    id: 'vantage-night-moon-hills',
    verse: '月出东山岭，清辉满竹村。',
    seal: '月满竹村',
    matchTime: ['night'],
    matchWeather: ['clear'],
    matchTags: ['moon', 'mountains', 'bamboo', 'village']
  },
  {
    id: 'vantage-spring-mist-valley',
    verse: '春岚浮绿野，十里画屏开。',
    seal: '春岚画屏',
    matchPhenology: ['spring'],
    matchWeather: ['mist', 'clear'],
    matchTags: ['mist-sea', 'mountains', 'field', 'peach']
  },

  // ---- 13. 补充农时节气与生灵微景（24条，总数达到 213 条） ----
  {
    id: 'fauna-buffalo-egret',
    verse: '老牛卧碧潭，白鹭立青背。',
    seal: '牛背白鹭',
    matchRegions: ['美池', '良田'],
    matchPhenology: ['summer', 'spring'],
    matchTime: ['day'],
    matchTags: ['ox', 'egret', 'pond']
  },
  {
    id: 'fauna-hen-chicks-sun',
    verse: '暖阳晒谷场，母鸡领群雏。',
    seal: '晒场鸡雏',
    matchRegions: ['桃源村', '人家'],
    matchTime: ['day'],
    matchWeather: ['clear'],
    matchTags: ['chicken', 'village', 'sunning']
  },
  {
    id: 'fauna-swallow-eaves',
    verse: '双燕绕茅檐，春风剪绿波。',
    seal: '双燕春檐',
    matchRegions: ['人家', '桃源村', '美池'],
    matchPhenology: ['spring', 'summer'],
    matchTime: ['day', 'dusk'],
    matchTags: ['bird', 'cottage', 'pond']
  },
  {
    id: 'fauna-ducks-ripples',
    verse: '群鸭划晴漪，红掌拨清萍。',
    seal: '鸭戏清波',
    matchRegions: ['美池', '武陵溪'],
    matchTime: ['day'],
    matchTags: ['duck', 'pond', 'stream']
  },
  {
    id: 'fauna-dog-lane',
    verse: '黄犬守柴扉，闲卧竹荫凉。',
    seal: '黄犬竹荫',
    matchRegions: ['人家', '桃源村'],
    matchTime: ['day', 'dusk'],
    matchTags: ['dog', 'cottage', 'bamboo']
  },
  {
    id: 'season-lichun-willow',
    verse: '东风解寒冻，溪柳暗生芽。',
    seal: '立春溪柳',
    matchPhenology: ['spring'],
    matchSolarTerms: ['立春', '雨水', '惊蛰'],
    matchTags: ['stream', 'wind']
  },
  {
    id: 'season-qingming-petals',
    verse: '清明春水暖，夹岸落花繁。',
    seal: '清明落花',
    matchPhenology: ['spring'],
    matchSolarTerms: ['清明', '春分'],
    matchTags: ['peach', 'petals', 'stream']
  },
  {
    id: 'season-guyu-tea',
    verse: '谷雨润青芽，山茶带露香。',
    seal: '谷雨新茶',
    matchPhenology: ['spring'],
    matchSolarTerms: ['谷雨'],
    matchTags: ['tea-hut', 'rain', 'herbs', 'paddy']
  },
  {
    id: 'season-xiazhi-lotus',
    verse: '夏至莲叶满，昼长蛙声圆。',
    seal: '夏至满池',
    matchPhenology: ['summer'],
    matchSolarTerms: ['夏至', '小满'],
    matchTags: ['lotus', 'pond', 'paddy']
  },
  {
    id: 'season-dashu-cicada',
    verse: '蝉鸣深竹里，流水转筒车。',
    seal: '大暑竹流',
    matchPhenology: ['summer'],
    matchSolarTerms: ['小暑', '大暑'],
    matchTags: ['bamboo', 'waterwheel', 'stream']
  },
  {
    id: 'season-bailu-dew',
    verse: '白露点秋禾，风吹金穗低。',
    seal: '白露秋禾',
    matchPhenology: ['autumn'],
    matchSolarTerms: ['白露', '秋分'],
    matchTags: ['millet', 'field', 'wind']
  },
  {
    id: 'season-hanlu-maple',
    verse: '霜风染丹枫，秋岭红似霞。',
    seal: '寒露霜枫',
    matchPhenology: ['autumn'],
    matchSolarTerms: ['寒露', '霜降'],
    matchTags: ['mountains', 'clouds', 'sunset']
  },
  {
    id: 'season-xiaoxue-hearth',
    verse: '小雪山岚冷，茅庐炉火温。',
    seal: '小雪炉温',
    matchPhenology: ['winter'],
    matchSolarTerms: ['立冬', '小雪'],
    matchTags: ['cottage', 'warm-lights', 'smoke', 'snow']
  },
  {
    id: 'season-dongzhi-night',
    verse: '冬至岁将暮，围炉话岁丰。',
    seal: '冬至围炉',
    matchPhenology: ['winter'],
    matchSolarTerms: ['大雪', '冬至', '小寒', '大寒'],
    matchTime: ['night', 'dusk'],
    matchTags: ['cottage', 'warm-lights', 'feast', 'bonfire']
  },
  {
    id: 'night-summer-clear-breeze',
    verse: '夏夜清风起，星光满稻畴。',
    seal: '星光稻畴',
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchWeather: ['clear', 'wind'],
    matchTags: ['stars', 'paddy', 'field', 'wind'],
    priority: 2.3
  },
  {
    id: 'night-summer-lantern-reed',
    verse: '竹灯照瓜棚，萤火拂芦梢。',
    seal: '瓜棚萤火',
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchTags: ['fireflies', 'warm-lights', 'paddy', 'cottage'],
    priority: 2.1
  },
  {
    id: 'night-summer-pond-lotus-moon',
    verse: '月洗池荷净，风摇竹影轻。',
    seal: '月洗池荷',
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchTags: ['moon', 'lotus', 'pond', 'bamboo'],
    priority: 2.2
  },
  {
    id: 'night-summer-paddy-cricket',
    verse: '田蛙鸣夏夜，星斗落平畦。',
    seal: '星斗平畦',
    matchPhenology: ['summer'],
    matchTime: ['night'],
    matchTags: ['paddy', 'stars', 'field'],
    priority: 2.4
  },
  {
    id: 'night-spring-peach-stars',
    verse: '春夜星垂林，落英浮静水。',
    seal: '星夜落英',
    matchPhenology: ['spring'],
    matchTime: ['night'],
    matchTags: ['peach', 'petals', 'stars', 'stream'],
    priority: 2.1
  },
  {
    id: 'night-autumn-frost-moon',
    verse: '秋宵月色白，露下稻田香。',
    seal: '秋月稻香',
    matchPhenology: ['autumn'],
    matchTime: ['night'],
    matchTags: ['moon', 'millet', 'field', 'stars'],
    priority: 2.1
  },
  {
    id: 'night-winter-star-snow',
    verse: '晴冬星斗冷，雪屋一灯红。',
    seal: '雪屋红灯',
    matchPhenology: ['winter'],
    matchTime: ['night'],
    matchWeather: ['clear', 'snow'],
    matchTags: ['snow', 'stars', 'cottage', 'warm-lights'],
    priority: 2.3
  },
  {
    id: 'dawn-spring-blossom-dew',
    verse: '晨露湿桃瓣，轻烟锁竹村。',
    seal: '晨露桃村',
    matchPhenology: ['spring'],
    matchTime: ['dawn'],
    matchTags: ['peach', 'bamboo', 'village', 'sunrise', 'mist-sea']
  },
  {
    id: 'dawn-summer-lotus-dew',
    verse: '晓风摇翠盖，玉露滚荷心。',
    seal: '晓风荷露',
    matchPhenology: ['summer'],
    matchTime: ['dawn'],
    matchTags: ['lotus', 'pond', 'sunrise', 'wind']
  },
  {
    id: 'dusk-summer-village-breeze',
    verse: '夕岚散稻畦，倦鸟归桑林。',
    seal: '夕岚稻畦',
    matchPhenology: ['summer'],
    matchTime: ['dusk'],
    matchTags: ['paddy', 'mulberry', 'bird', 'sunset', 'field']
  },
  // ---- 山野七奇专属题跋 ----
  {
    id: 'wilds-crane-nest-verse',
    verse: '绝壁苍松顶，霜禽栖暮云。',
    seal: '松鹤清唳',
    requiresTag: 'crane-nest',
    matchTags: ['crane-nest', 'pine', 'mountains'],
    priority: 8.5
  },
  {
    id: 'wilds-stone-sundial-verse',
    verse: '青石承天晷，山中忘岁年。',
    seal: '石晷移影',
    requiresTag: 'stone-sundial',
    matchTags: ['stone-sundial', 'ancient-stele', 'mountains'],
    priority: 8.5
  },
  {
    id: 'wilds-jade-echo-spring-verse',
    verse: '翠壁回清响，幽潭漱玉泉。',
    seal: '空谷三叠',
    requiresTag: 'echo-spring',
    matchTags: ['echo-spring', 'stream', 'waterfall'],
    priority: 8.5
  },
  {
    id: 'wilds-hermit-wine-cellar-verse',
    verse: '松根藏腊酿，风过泥封香。',
    seal: '松下春醪',
    requiresTag: 'wine-cellar',
    matchTags: ['wine-cellar', 'pine'],
    priority: 8.5
  },
  {
    id: 'wilds-firefly-lantern-shrine-verse',
    verse: '苔龛栖夜火，点点落松阴。',
    seal: '流萤古龛',
    requiresTag: 'firefly-shrine',
    matchTags: ['firefly-shrine', 'fireflies', 'bamboo'],
    priority: 8.5
  },
  {
    id: 'wilds-ancient-kiln-cache-verse',
    verse: '柴窑留古匣，雨过釉色青。',
    seal: '青瓷秘匣',
    requiresTag: 'celadon-cache',
    matchTags: ['celadon-cache', 'kiln'],
    priority: 8.5
  },
  {
    id: 'wilds-bamboo-wind-chimes-verse',
    verse: '风穿青竹管，清韵满山阿。',
    seal: '清风竹铃',
    requiresTag: 'wind-chimes',
    matchTags: ['wind-chimes', 'bamboo', 'stream'],
    priority: 8.5
  }
];

// ---- 景物即景联句库（严格平仄格律：上联仄收、下联平收；按五言/七言同律组合） ----
// 仅在场景显性特征强烈时动态叠翠配联，绝不重复单句字词且严格校验时令天象相容性
const COMPOSE_UPPER_LINES = [
  // 五言上联（仄声收尾；tags[0] 为必须命中的画心主景物）
  { text: '萤火穿修竹', meter: 5, tags: ['fireflies', 'bamboo'], seal2: '萤竹', matchPhenology: ['summer', 'spring'], matchTime: ['night'], avoidPhenology: ['winter'], avoidTime: ['day'] },
  { text: '星影浮新稻', meter: 5, tags: ['paddy', 'stars'], seal2: '星稻', matchPhenology: ['summer', 'spring'], matchTime: ['night'], avoidTime: ['day'] },
  { text: '水田涵夜色', meter: 5, tags: ['paddy', 'field'], seal2: '田夜', matchPhenology: ['summer', 'spring'], matchTime: ['night', 'dusk'], avoidTime: ['day'] },
  { text: '茅舍漏灯暖', meter: 5, tags: ['warm-lights', 'cottage'], seal2: '茅灯', matchTime: ['night', 'dusk'], avoidTime: ['day'] },
  { text: '荷露滴清响', meter: 5, tags: ['lotus', 'pond'], seal2: '荷露', matchPhenology: ['summer'], avoidPhenology: ['winter'] },
  { text: '飞瀑漱寒玉', meter: 5, tags: ['waterfall', 'stream'], seal2: '飞瀑' },
  { text: '渔火照寒渡', meter: 5, tags: ['ferry', 'boat'], seal2: '渔火', matchPhenology: ['winter', 'autumn'], matchTime: ['night', 'dusk'] },
  { text: '桃林飞红雨', meter: 5, tags: ['peach', 'petals'], seal2: '红雨', matchPhenology: ['spring'], avoidPhenology: ['winter'], avoidWeather: ['snow'] },
  { text: '竹影拂石案', meter: 5, tags: ['bamboo', 'liubo'], seal2: '竹影', matchTime: ['day', 'night', 'dusk'] },
  { text: '炊烟绕碧瓦', meter: 5, tags: ['smoke', 'cottage'], seal2: '炊烟', matchTime: ['dawn', 'day', 'dusk'], avoidTime: ['night'], avoidWeather: ['rain'] },
  { text: '晴虹挂远岫', meter: 5, tags: ['rainbow', 'mountains'], seal2: '晴虹', avoidTime: ['night'], avoidPhenology: ['winter'] },
  { text: '秋雁破云碧', meter: 5, tags: ['geese', 'clouds'], seal2: '秋雁', matchPhenology: ['autumn'], avoidTime: ['night'] },
  { text: '素雪覆茅屋', meter: 5, tags: ['snow', 'cottage'], seal2: '素雪', matchPhenology: ['winter'] },
  { text: '晓雾迷幽径', meter: 5, tags: ['mist-sea', 'cave'], seal2: '晓雾', matchTime: ['dawn'], matchWeather: ['mist', 'clear'] },
  { text: '松风响翠谷', meter: 5, tags: ['pine', 'mountains'], seal2: '松风' },
  { text: '青牛踏沃野', meter: 5, tags: ['ox-plowing', 'ox'], seal2: '春耕', avoidPhenology: ['winter'], avoidTime: ['night'] },
  { text: '轻舟过画岸', meter: 5, tags: ['boat', 'skiff-aboard'], seal2: '轻舟' },
  { text: '素月照平水', meter: 5, tags: ['moon', 'pond'], seal2: '月水', matchTime: ['night'], avoidTime: ['day'], avoidWeather: ['rain', 'snow'] },
  { text: '金粟压秋陌', meter: 5, tags: ['millet', 'field'], seal2: '金粟', matchPhenology: ['autumn'] },
  { text: '层梯映落照', meter: 5, tags: ['terrace', 'sunset'], seal2: '梯照', matchTime: ['dusk', 'dawn'] },
  { text: '高亭迎远黛', meter: 5, tags: ['cloud-pavilion', 'pavilion'], seal2: '亭黛' },
  { text: '细雨润桑叶', meter: 5, tags: ['rain', 'mulberry'], seal2: '雨桑', matchWeather: ['rain'], avoidPhenology: ['winter'] },
  { text: '白鹿饮深涧', meter: 5, tags: ['stag', 'hermitage'], seal2: '白鹿' },
  { text: '素琴鸣石上', meter: 5, tags: ['guqin', 'pine'], seal2: '素琴' },
  { text: '村舍掩青翠', meter: 5, tags: ['village', 'cottage'], seal2: '青村', avoidPhenology: ['winter'] },
  { text: '水碓捣新谷', meter: 5, tags: ['water-mortar', 'waterwheel'], seal2: '水碓' },
  { text: '茶炉沸松雪', meter: 5, tags: ['tea-hut', 'snow'], seal2: '茶雪', matchPhenology: ['winter'] },
  { text: '夕照染孤岭', meter: 5, tags: ['sunset', 'mountains'], seal2: '夕岭', matchTime: ['dusk'] },
  { text: '药圃郁芳草', meter: 5, tags: ['herbs', 'field'], seal2: '药圃', avoidPhenology: ['winter'] },
  { text: '凌虚俯翠谷', meter: 5, tags: ['aerial', 'mountains'], seal2: '凌虚' },
  { text: '古窑生暖气', meter: 5, tags: ['kiln', 'smoke'], seal2: '古窑' },
  { text: '远峰浮翠霭', meter: 5, tags: ['mountains', 'clouds'], seal2: '翠峰' },
  { text: '石枰落白子', meter: 5, tags: ['lanke-chess', 'pine'], seal2: '白子' },
  { text: '云樵归野径', meter: 5, tags: ['woodcutter-hut', 'mountains'], seal2: '云樵' },

  // 七言上联（仄声收尾；tags[0] 为必须命中的画心主景物）
  { text: '水田镜净涵星汉', meter: 7, tags: ['paddy', 'stars', 'milky-way'], seal2: '星汉', matchPhenology: ['summer', 'spring'], matchTime: ['night'], avoidTime: ['day'] },
  { text: '芒种秧青浮夜露', meter: 7, tags: ['paddy', 'fireflies'], seal2: '秧露', matchPhenology: ['summer'], matchTime: ['night', 'dawn'], avoidTime: ['day'] },
  { text: '绿野萤飞迷竹径', meter: 7, tags: ['fireflies', 'bamboo'], seal2: '萤径', matchPhenology: ['summer', 'spring'], matchTime: ['night'], avoidPhenology: ['winter'], avoidTime: ['day'] },
  { text: '茅舍窗明分暖火', meter: 7, tags: ['warm-lights', 'cottage'], seal2: '暖窗', matchTime: ['night', 'dusk'] },
  { text: '夹岸桃花随水去', meter: 7, tags: ['peach', 'petals', 'stream'], seal2: '桃水', matchPhenology: ['spring'], avoidPhenology: ['winter'] },
  { text: '碧沼荷风摇翠盖', meter: 7, tags: ['lotus', 'pond'], seal2: '荷风', matchPhenology: ['summer'], avoidPhenology: ['winter'] },
  { text: '筒车汲浪穿青野', meter: 7, tags: ['waterwheel', 'field'], seal2: '筒车', avoidPhenology: ['winter'] },
  { text: '三叠飞泉喷白玉', meter: 7, tags: ['waterfall', 'stream'], seal2: '三叠' },
  { text: '东皋亭外浮云海', meter: 7, tags: ['cloud-pavilion', 'clouds'], seal2: '云海' },
  { text: '层梯蓄水收天色', meter: 7, tags: ['terrace', 'paddy'], seal2: '梯水' },
  { text: '寒溪雪密孤舟静', meter: 7, tags: ['snow', 'boat', 'ferry'], seal2: '雪舟', matchPhenology: ['winter'] },
  { text: '晚照铺金连稻陇', meter: 7, tags: ['sunset', 'millet', 'field'], seal2: '晚稻', matchTime: ['dusk'] },
  { text: '石罅微光开别境', meter: 7, tags: ['cave', 'mountains'], seal2: '石罅' },
  { text: '烟雨空蒙笼远黛', meter: 7, tags: ['rain', 'mist-sea', 'mountains'], seal2: '烟黛', matchWeather: ['rain', 'mist'] },
  { text: '古树垂荫聚黄发', meter: 7, tags: ['social-tree', 'elders'], seal2: '古荫', matchTime: ['day', 'dusk'], avoidTime: ['night'] },
  { text: '松岭茶烟浮翠霭', meter: 7, tags: ['tea-hut', 'pine', 'smoke'], seal2: '茶烟' },
  { text: '鹿柴修竹连幽草', meter: 7, tags: ['hermitage', 'bamboo'], seal2: '鹿柴' },
  { text: '山阿古窑松柴旺', meter: 7, tags: ['kiln', 'smoke'], seal2: '山窑' },
  { text: '御风高览千峰碧', meter: 7, tags: ['aerial', 'mountains'], seal2: '高览' },
  { text: '仰首银河横玉宇', meter: 7, tags: ['skyward', 'milky-way', 'stars'], seal2: '银河', matchTime: ['night'], matchWeather: ['clear'] }
];

const COMPOSE_LOWER_LINES = [
  // 五言下联（平声收尾；tags[0] 为必须命中的画心主景物）
  { text: '竹亭听微蝉', meter: 5, tags: ['pavilion', 'bamboo'], seal2: '亭蝉', matchPhenology: ['summer'], matchTime: ['day', 'dusk', 'night'], avoidPhenology: ['winter'] },
  { text: '灯火照孤村', meter: 5, tags: ['warm-lights', 'village'], seal2: '村灯', matchTime: ['night', 'dusk'], avoidTime: ['day'] },
  { text: '蛙声满夏田', meter: 5, tags: ['paddy', 'pond'], seal2: '田蛙', matchPhenology: ['summer'], matchTime: ['dusk', 'night'], avoidPhenology: ['winter'] },
  { text: '银河垂半空', meter: 5, tags: ['stars', 'milky-way'], seal2: '银河', matchTime: ['night'], matchWeather: ['clear'], avoidTime: ['day'] },
  { text: '流萤点翠微', meter: 5, tags: ['fireflies', 'mountains'], seal2: '流萤', matchPhenology: ['summer', 'spring'], matchTime: ['night'], avoidPhenology: ['winter'], avoidTime: ['day'] },
  { text: '炊烟起远村', meter: 5, tags: ['smoke', 'village'], seal2: '村烟', matchTime: ['dawn', 'day', 'dusk'], avoidWeather: ['rain'] },
  { text: '松风入素弦', meter: 5, tags: ['guqin', 'pine'], seal2: '松弦' },
  { text: '清风拂竹亭', meter: 5, tags: ['pavilion', 'wind'], seal2: '风亭' },
  { text: '溪声伴鸟鸣', meter: 5, tags: ['stream', 'bird'], seal2: '溪鸟', matchTime: ['dawn', 'day', 'dusk'], avoidTime: ['night'] },
  { text: '微澜荡画舟', meter: 5, tags: ['boat', 'skiff-drifting'], seal2: '画舟' },
  { text: '繁星落平畴', meter: 5, tags: ['stars', 'field'], seal2: '星畴', matchTime: ['night'], matchWeather: ['clear'], avoidTime: ['day'] },
  { text: '青篁映野塘', meter: 5, tags: ['pond', 'bamboo'], seal2: '竹塘', avoidPhenology: ['winter'] },
  { text: '村犬吠深篱', meter: 5, tags: ['dog', 'village'], seal2: '深篱' },
  { text: '芳菲满武陵', meter: 5, tags: ['peach', 'petals'], seal2: '武陵', matchPhenology: ['spring'], avoidPhenology: ['winter'] },
  { text: '秋阳晒谷忙', meter: 5, tags: ['sunning', 'millet'], seal2: '晒秋', matchPhenology: ['autumn'], matchTime: ['day', 'dusk'], avoidTime: ['night'] },
  { text: '寒枝伴瓦檐', meter: 5, tags: ['snow', 'cottage'], seal2: '寒檐', matchPhenology: ['winter'] },
  { text: '山岚隐石门', meter: 5, tags: ['mist-sea', 'cave'], seal2: '山岚' },
  { text: '晴云度远峰', meter: 5, tags: ['clouds', 'mountains'], seal2: '云峰', matchTime: ['day', 'dawn', 'dusk'], avoidTime: ['night'], avoidWeather: ['rain', 'snow'] },
  { text: '闲鹭逐波飞', meter: 5, tags: ['egret', 'duck'], seal2: '飞鹭', matchTime: ['day', 'dawn', 'dusk'], avoidTime: ['night'] },
  { text: '篝火暖村宵', meter: 5, tags: ['bonfire', 'feast'], seal2: '篝火', matchTime: ['night', 'dusk'] },
  { text: '茶香出草寮', meter: 5, tags: ['tea-hut', 'cottage'], seal2: '茶寮' },
  { text: '清溪绕桑麻', meter: 5, tags: ['stream', 'mulberry'], seal2: '桑溪', avoidPhenology: ['winter'] },
  { text: '山村百岁闲', meter: 5, tags: ['village', 'elders'], seal2: '闲村' },
  { text: '青禾连远山', meter: 5, tags: ['paddy', 'mountains'], seal2: '禾山', matchPhenology: ['spring', 'summer'] },
  { text: '冰痕抱岸石', meter: 5, tags: ['shore-ice', 'stream'], seal2: '岸冰', matchPhenology: ['winter'] },
  { text: '归禽入晚烟', meter: 5, tags: ['sunset', 'bird'], seal2: '晚烟', matchTime: ['dusk'] },
  { text: '新秧绿满溪', meter: 5, tags: ['paddy', 'stream'], seal2: '绿秧', matchPhenology: ['spring', 'summer'] },
  { text: '云开见古村', meter: 5, tags: ['village', 'aerial'], seal2: '古村', avoidWeather: ['rain', 'snow'] },
  { text: '石枰落子轻', meter: 5, tags: ['lanke-chess', 'liubo'], seal2: '落子' },
  { text: '遥岑生紫烟', meter: 5, tags: ['mountains', 'clouds'], seal2: '遥岑' },
  { text: '山阿话桑麻', meter: 5, tags: ['mountains', 'village'], seal2: '山阿' },
  { text: '微雨润良田', meter: 5, tags: ['rain', 'field'], seal2: '雨田', matchWeather: ['rain'] },

  // 七言下联（平声收尾；tags[0] 为必须命中的画心主景物）
  { text: '竹影亭前萤火飞', meter: 7, tags: ['fireflies', 'pavilion', 'bamboo'], seal2: '萤飞', matchPhenology: ['summer', 'spring'], matchTime: ['night'], avoidPhenology: ['winter'], avoidTime: ['day'] },
  { text: '柴门灯暖照溪村', meter: 7, tags: ['warm-lights', 'cottage', 'village'], seal2: '村灯', matchTime: ['night', 'dusk'], avoidTime: ['day'] },
  { text: '清风入夜送荷香', meter: 7, tags: ['lotus', 'pond', 'wind'], seal2: '荷香', matchPhenology: ['summer'], matchTime: ['night', 'dusk'], avoidPhenology: ['winter'] },
  { text: '青秧千亩映天光', meter: 7, tags: ['paddy', 'field'], seal2: '青秧', matchPhenology: ['spring', 'summer'] },
  { text: '溪山万里入画屏', meter: 7, tags: ['mountains', 'aerial', 'stream'], seal2: '画屏' },
  { text: '鸡犬相闻桑竹间', meter: 7, tags: ['village', 'mulberry', 'chicken', 'dog'], seal2: '桑竹', matchTime: ['day', 'dawn', 'dusk'], avoidTime: ['night'] },
  { text: '渔歌一曲下清流', meter: 7, tags: ['boat', 'skiff-aboard', 'stream'], seal2: '渔歌' },
  { text: '金粟盈畴醉秋风', meter: 7, tags: ['millet', 'field', 'wind'], seal2: '金秋', matchPhenology: ['autumn'] },
  { text: '炉火红泥温旧醅', meter: 7, tags: ['cottage', 'feast', 'snow'], seal2: '炉温', matchPhenology: ['winter', 'autumn'], matchTime: ['night', 'dusk'] },
  { text: '数声清磬过松林', meter: 7, tags: ['pine', 'wind'], seal2: '松磬' },
  { text: '白鹭穿云落浅滩', meter: 7, tags: ['egret', 'stream'], seal2: '浅鹭', matchTime: ['day', 'dawn', 'dusk'], avoidTime: ['night'] },
  { text: '平明烟水绕山居', meter: 7, tags: ['sunrise', 'mist-sea', 'village'], seal2: '晓烟', matchTime: ['dawn'] },
  { text: '蜻蜓点水逗红莲', meter: 7, tags: ['dragonfly', 'lotus'], seal2: '蜻莲', matchPhenology: ['summer'], matchTime: ['day', 'dawn'], avoidTime: ['night'] },
  { text: '樵歌归晚带松烟', meter: 7, tags: ['woodcutter-hut', 'sunset'], seal2: '樵歌', matchTime: ['dusk'] },
  { text: '水田星斗伴虫鸣', meter: 7, tags: ['paddy', 'stars'], seal2: '星田', matchPhenology: ['summer', 'spring'], matchTime: ['night'], avoidTime: ['day'] },
  { text: '古窑烟暖话耕桑', meter: 7, tags: ['kiln', 'smoke'], seal2: '古窑' },
  { text: '素月清辉满竹林', meter: 7, tags: ['moon', 'bamboo'], seal2: '竹月', matchTime: ['night'], avoidTime: ['day'], avoidWeather: ['rain', 'snow'] },
  { text: '山川无历四时春', meter: 7, tags: ['mountains', 'village'], seal2: '四时' }
];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashText(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 20261121;
}

function buildExpandedRegionList(world, sceneContext) {
  const base = Array.isArray(world?.map?.regions) ? world.map.regions.slice() : [];
  const isMainWorld = Array.isArray(world?.map?.pois) && world.map.pois.some(p => p && p.id === 'wuling');
  if (!isMainWorld || !Array.isArray(mapExpansion?.regions)) return base;

  const pavRegion = sceneContext?.leisureGrove?.layout?.regions?.find(r => r && r.kind === 'pavilion');
  const wwWheel = sceneContext?.waterworks?.layout?.wheels?.[0];
  for (let i = 0; i < mapExpansion.regions.length; i++) {
    const r = mapExpansion.regions[i];
    if (!r) continue;
    let x = r.x;
    let z = r.z;
    if (r.dynamic === 'pavilion' && pavRegion && Number.isFinite(pavRegion.x) && Number.isFinite(pavRegion.z)) {
      x = pavRegion.x;
      z = pavRegion.z;
    } else if (r.dynamic === 'waterworks' && wwWheel && Number.isFinite(wwWheel.x) && Number.isFinite(wwWheel.z)) {
      x = wwWheel.x;
      z = wwWheel.z;
    }
    base.push({ ...r, x, z });
  }
  return base;
}

export function resolveExpandedRegionAt(px, pz, world, sceneContext = null) {
  if (!Number.isFinite(px) || !Number.isFinite(pz)) return '';
  const regions = buildExpandedRegionList(world, sceneContext);
  if (regions.length) {
    let bestName = '';
    let bestScore = 0;
    for (let i = 0; i < regions.length; i++) {
      const rg = regions[i];
      const rad = rg.r || 1;
      const dist = Math.hypot(px - rg.x, pz - rg.z);
      if (dist > rad) continue;
      const score = 1 - dist / rad + (rg.priority || 0);
      if (score > bestScore) {
        bestScore = score;
        bestName = rg.name;
      }
    }
    if (bestName) return bestName;
  }
  const pois = Array.isArray(world?.map?.pois) ? world.map.pois.slice() : [];
  if (Array.isArray(mapExpansion?.pois) && pois.some(p => p && p.id === 'wuling')) {
    pois.push(...mapExpansion.pois);
  }
  if (pois.length) {
    let nearest = pois[0];
    let bestDist = Infinity;
    for (let i = 0; i < pois.length; i++) {
      const d = Math.hypot(px - pois[i].x, pz - pois[i].z);
      if (d < bestDist) {
        bestDist = d;
        nearest = pois[i];
      }
    }
    if (nearest?.name) return nearest.name;
  }
  return '';
}

function getCameraBasis(pose, camera, player, field) {
  const px = Number.isFinite(pose?.x) ? pose.x : (Number(player?.state?.x) || 0);
  const pz = Number.isFinite(pose?.z) ? pose.z : (Number(player?.state?.z) || 0);
  const groundY = typeof field?.sample === 'function' ? field.sample(px, pz) : (Number(player?.state?.y) || 0);
  const py = Number.isFinite(player?.state?.y) ? player.state.y : groundY;
  const yaw = Number.isFinite(pose?.yaw) ? pose.yaw : (Number(player?.state?.yaw) || 0);
  const pitch = Number.isFinite(player?.state?.camPitch)
    ? player.state.camPitch
    : (Number.isFinite(player?.state?.pitch) ? player.state.pitch : 0);

  const camX = Number(camera?.position?.x);
  const camY = Number(camera?.position?.y);
  const camZ = Number(camera?.position?.z);
  const camValid = Number.isFinite(camX) && Number.isFinite(camY) && Number.isFinite(camZ);
  const camNearPlayer = camValid && Math.hypot(camX - px, camZ - pz) <= 14;
  const camMovedFromOrigin = camValid && (
    Math.hypot(camX, camY, camZ) > 1e-4 || !(Math.abs(yaw) > 1e-4 || Math.abs(pitch) > 1e-4)
  );
  const useCam = Boolean(pose?.detached ? camValid : (camNearPlayer && camMovedFromOrigin));

  let posX = px;
  let posY = py + 1.65;
  let posZ = pz;
  let fwdX = -Math.sin(yaw) * Math.cos(pitch);
  let fwdY = Math.sin(pitch);
  let fwdZ = -Math.cos(yaw) * Math.cos(pitch);
  let rightX = Math.cos(yaw);
  let rightY = 0;
  let rightZ = -Math.sin(yaw);

  if (useCam) {
    posX = camX;
    posY = camY;
    posZ = camZ;
    const q = camera.quaternion;
    if (q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w)) {
      const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
      const rotVec = (vx, vy, vz) => {
        const ix = qw * vx + qy * vz - qz * vy;
        const iy = qw * vy + qz * vx - qx * vz;
        const iz = qw * vz + qx * vy - qy * vx;
        const iw = -qx * vx - qy * vy - qz * vz;
        return [
          ix * qw + iw * -qx + iy * -qz - iz * -qy,
          iy * qw + iw * -qy + iz * -qx - ix * -qz,
          iz * qw + iw * -qz + ix * -qy - iy * -qx
        ];
      };
      const f = rotVec(0, 0, -1);
      const r = rotVec(1, 0, 0);
      const fLen = Math.hypot(f[0], f[1], f[2]) || 1;
      const rLen = Math.hypot(r[0], r[1], r[2]) || 1;
      fwdX = f[0] / fLen; fwdY = f[1] / fLen; fwdZ = f[2] / fLen;
      rightX = r[0] / rLen; rightY = r[1] / rLen; rightZ = r[2] / rLen;
    }
  }

  // up = cross(right, fwd)
  const upX = rightY * fwdZ - rightZ * fwdY;
  const upY = rightZ * fwdX - rightX * fwdZ;
  const upZ = rightX * fwdY - rightY * fwdX;
  const fovDeg = Number.isFinite(camera?.fov) ? camera.fov : 55;
  const aspect = Number.isFinite(camera?.aspect) && camera.aspect > 0.2 ? camera.aspect : 1.78;
  const tanHalfY = Math.tan((clamp(fovDeg, 25, 110) * Math.PI) / 360);
  const tanHalfX = tanHalfY * aspect;
  const viewPitch = Math.asin(clamp(fwdY, -1, 1));
  const localGround = typeof field?.sample === 'function' ? field.sample(posX, posZ) : py;
  const elevation = posY - (Number.isFinite(localGround) ? localGround : 0);

  return {
    posX, posY, posZ,
    fwdX, fwdY, fwdZ,
    rightX, rightY, rightZ,
    upX, upY, upZ,
    tanHalfX, tanHalfY,
    pitch: viewPitch,
    elevation
  };
}

const TARGET_ID_TAGS = {
  peach: ['peach'],
  bamboo: ['bamboo'],
  mulberry: ['mulberry'],
  field: ['field'],
  'grain-crop': ['field'],
  'millet-field': ['millet', 'field'],
  pond: ['pond'],
  lotus: ['lotus', 'pond'],
  'lotus-rhizome': ['lotus', 'pond'],
  duckweed: ['pond'],
  carp: ['fish', 'pond'],
  dragonfly: ['dragonfly', 'lotus', 'pond'],
  stream: ['stream'],
  cave: ['cave'],
  boat: ['boat', 'stream'],
  'fishing-skiff': ['boat', 'stream'],
  'wuling-bamboo-raft': ['boat', 'ferry', 'stream'],
  'wuling-ferry-pavilion': ['ferry', 'pavilion', 'stream'],
  'wuling-shore-ice': ['shore-ice', 'stream'],
  'wuling-creek-egret': ['egret', 'stream'],
  'outskirt-tea-shelter': ['tea-hut', 'cottage'],
  'outskirt-welcoming-pine': ['pine'],
  'thatched-pavilion': ['pavilion'],
  'liubo-board': ['liubo', 'pavilion'],
  waterwheel: ['waterwheel', 'stream'],
  'bamboo-irrigation': ['waterwheel'],
  'water-mortar': ['water-mortar', 'stream'],
  'social-tree': ['social-tree', 'village'],
  'timber-footbridge': ['bridge', 'stream'],
  'split-log-bridge': ['bridge', 'stream'],
  'ox-plowing': ['ox-plowing', 'ox', 'field'],
  'plowing-ox': ['ox-plowing', 'ox', 'field'],
  'wooden-plow': ['ox-plowing', 'field'],
  'field-hut': ['field', 'cottage'],
  'wallowing-buffalo': ['ox', 'egret', 'pond'],
  'hen-chicks': ['chicken', 'village'],
  'swallow-nest': ['bird', 'cottage'],
  'clay-fou': ['feast', 'bonfire'],
  'hearth-alcove': ['cottage', 'warm-lights'],
  'cloud-terraces': ['terrace', 'paddy', 'field'],
  'mountain-cascade': ['waterfall', 'stream'],
  'wild-tea-herbs': ['herbs'],
  'cliff-pine': ['pine'],
  'cloud-pavilion': ['cloud-pavilion', 'pavilion'],
  'mountain-goat': ['goat'],
  'qianmo-lanes': ['field'],
  'lanke-chess-crag': ['lanke-chess', 'pine'],
  'ancient-climbing-kiln': ['kiln'],
  'deer-brushwood-hermitage': ['hermitage', 'bamboo'],
  'mountain-tea-shelter': ['tea-hut', 'pine'],
  'cloud-ridge-woodcutter-hut': ['woodcutter-hut', 'cottage'],
  'ancient-qin-altar': ['altar', 'social-tree'],
  'cold-spring-study': ['study', 'ancient-stele', 'stream'],
  'jade-rill-tea-terrace': ['tea-terrace', 'tea-hut', 'stream'],
  'wilds-crane-nest': ['crane-nest', 'pine'],
  'wilds-stone-sundial': ['stone-sundial', 'ancient-stele'],
  'wilds-jade-echo-spring': ['echo-spring', 'stream'],
  'wilds-hermit-wine-cellar': ['wine-cellar', 'pine'],
  'wilds-firefly-lantern-shrine': ['firefly-shrine', 'fireflies'],
  'wilds-ancient-kiln-cache': ['celadon-cache', 'kiln'],
  'wilds-bamboo-wind-chimes': ['wind-chimes', 'bamboo'],
  'cloud-guqin-stone': ['guqin', 'pine'],
  'moon-white-stag': ['stag'],
  'peach-wind-tallies': ['peach', 'social-tree'],
  'camphor-hollow-brew': ['social-tree'],
  'floating-wine-cup': ['stream'],
  'qin-bamboo-slips': ['ancient-stele'],
  'plum-tree': ['peach'],
  'chestnut-tree': ['mulberry'],
  'laundry-stone': ['pond'],
  'harvest-tub': ['pond', 'lotus'],
  chicken: ['chicken'],
  dog: ['dog'],
  ox: ['ox'],
  duck: ['duck'],
  bird: ['bird']
};

const WILDS_WONDER_TAGS = new Set([
  'crane-nest',
  'stone-sundial',
  'echo-spring',
  'wine-cellar',
  'firefly-shrine',
  'celadon-cache',
  'wind-chimes'
]);

const TAG_SCORE_CAPS = {
  paddy: 4.5,
  field: 4.2,
  cottage: 4.2,
  village: 3.6,
  'warm-lights': 4.4,
  bamboo: 3.8,
  mulberry: 3.2,
  peach: 4.0,
  pond: 4.2,
  lotus: 4.6,
  stream: 4.2,
  pavilion: 4.0,
  fireflies: 4.5,
  stars: 3.6,
  'milky-way': 3.6,
  moon: 3.6,
  mountains: 3.2,
  clouds: 3.2
};

export function analyzeScrollScene({
  pose,
  camera,
  player,
  field,
  world,
  region,
  sky,
  skyInfo,
  phenology,
  clockInfo,
  riverSkiff,
  godFlight,
  sceneContext
} = {}) {
  const phenologyId = phenology?.id || 'spring';
  const timeId = skyInfo?.timeId || sky?.timeId || 'day';
  const weatherId = skyInfo?.weatherId || sky?.weatherId || 'clear';
  const solarTerm = clockInfo?.solarTerm || '';
  const lunarName = sky?.getLunarState?.()?.name || '';
  const isNight = timeId === 'night';
  const isDawn = timeId === 'dawn';
  const isDusk = timeId === 'dusk';
  const isDay = timeId === 'day';
  const isRain = weatherId === 'rain';
  const isMist = weatherId === 'mist';
  const isSnow = weatherId === 'snow';
  const isWind = weatherId === 'wind';

  const basis = getCameraBasis(pose, camera, player, field);
  const tagScores = new Map();
  const tagCounts = new Map();

  function addTagScore(tag, weight) {
    if (!tag || !Number.isFinite(weight) || weight <= 0) return;
    const seen = (tagCounts.get(tag) || 0) + 1;
    tagCounts.set(tag, seen);
    // 同类大量景物采用递减累加并封顶，防止大片竹林/稻株淹没亭台、流萤等画眼
    const diminished = weight / Math.sqrt(seen);
    const cap = TAG_SCORE_CAPS[tag] || 4.8;
    const prev = tagScores.get(tag) || 0;
    tagScores.set(tag, Math.min(cap, prev + diminished));
  }

  function projectVis(x, y, z, maxDist = 145) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const wy = Number.isFinite(y) ? y : (typeof field?.sample === 'function' ? field.sample(x, z) + 1.0 : basis.posY);
    const dx = x - basis.posX;
    const dy = wy - basis.posY;
    const dz = z - basis.posZ;
    const depth = dx * basis.fwdX + dy * basis.fwdY + dz * basis.fwdZ;
    if (depth < -1.5 || depth > maxDist) return 0;
    const horizDist = Math.hypot(dx, dz);
    if (depth < 0) {
      return horizDist <= 5.5 ? 0.35 : 0;
    }
    const rx = dx * basis.rightX + dy * basis.rightY + dz * basis.rightZ;
    const uy = dx * basis.upX + dy * basis.upY + dz * basis.upZ;
    const dSafe = Math.max(2.0, depth);
    const nx = Math.abs(rx) / (dSafe * basis.tanHalfX);
    const ny = Math.abs(uy) / (dSafe * basis.tanHalfY);
    if (nx > 1.18 || ny > 1.25) return 0;
    const centerBias = (1 - Math.min(1, nx / 1.18) * 0.45) * (1 - Math.min(1, ny / 1.25) * 0.35);
    const distWeight = 1 / (1 + Math.pow(horizDist / 48, 1.35));
    return clamp(centerBias * distWeight * 1.45, 0.05, 1.5);
  }

  function addVisibleTags(x, y, z, tags, baseWeight = 1.0, maxDist = 145) {
    const w = projectVis(x, y, z, maxDist);
    if (w <= 0) return 0;
    for (let i = 0; i < tags.length; i++) {
      addTagScore(tags[i], w * baseWeight);
    }
    return w;
  }

  const ctx = sceneContext || {};

  // 1. 显性地理奇观与营造地标 targets
  const targetLists = [
    ctx.wildsEasterEggs?.targets,
    ctx.deepHollows?.targets,
    ctx.leisureGrove?.targets,
    ctx.pondLife?.targets,
    ctx.waterworks?.targets
  ];
  const seenTargetIds = new Set();
  for (let li = 0; li < targetLists.length; li++) {
    const list = targetLists[li];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !t.id || seenTargetIds.has(t.id)) continue;
      seenTargetIds.add(t.id);
      const resolved = typeof t.resolve === 'function' ? t.resolve() : t;
      const tx = Number(resolved?.x ?? t.x);
      const ty = Number(resolved?.y ?? t.y);
      const tz = Number(resolved?.z ?? t.z);
      const mapped = TARGET_ID_TAGS[t.id];
      if (mapped) {
        if (t.id === 'lotus' && (phenologyId === 'winter' || phenologyId === 'autumn')) {
          addVisibleTags(tx, ty, tz, ['withered-lotus', 'pond'], 1.4, 110);
        } else if (t.id === 'wuling-shore-ice' && phenologyId !== 'winter') {
          continue;
        } else if (t.id.startsWith('wilds-')) {
          addVisibleTags(tx, ty, tz, [mapped[0]], 3.6, 34);
          if (mapped.length > 1) addVisibleTags(tx, ty, tz, mapped.slice(1), 1.2, 34);
        } else {
          addVisibleTags(tx, ty, tz, mapped, 1.65, 135);
        }
      }
    }
  }

  // 2. 村舍（含夜灯与炊烟）
  const houses = ctx.village?.houseInfo;
  if (Array.isArray(houses)) {
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      const w = addVisibleTags(h.x, (h.gy || 0) + 1.8, h.z, ['cottage', 'village'], 1.2, 165);
      if (w > 0) {
        if (isNight || isDusk) addTagScore('warm-lights', w * (isNight ? 1.55 : 0.95));
        if (!isRain && !isNight) addTagScore('smoke', w * (isDawn || isDusk ? 1.05 : 0.65));
      }
    }
  }

  // 3. 良田水田 / 秋粟 / 冬茬
  const plots = ctx.village?.plots;
  if (Array.isArray(plots) && plots.length) {
    for (let i = 0; i < plots.length; i++) {
      const p = plots[i];
      const fTags = phenologyId === 'summer' || phenologyId === 'spring'
        ? ['paddy', 'field']
        : (phenologyId === 'autumn' ? ['millet', 'field'] : ['field']);
      addVisibleTags(p[0], NaN, p[1], fTags, 1.25, 145);
    }
  } else if (Array.isArray(world?.village?.fields?.blocks)) {
    const blocks = world.village.fields.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const fTags = phenologyId === 'summer' || phenologyId === 'spring'
        ? ['paddy', 'field']
        : (phenologyId === 'autumn' ? ['millet', 'field'] : ['field']);
      addVisibleTags(b.x, NaN, b.z, fTags, 1.35, 145);
    }
  }

  // 4. 美池荷塘
  const pond = ctx.village?.pond || world?.terrain?.pond;
  if (pond && Number.isFinite(pond.x) && Number.isFinite(pond.z)) {
    const pTags = phenologyId === 'summer'
      ? ['pond', 'lotus']
      : (phenologyId === 'spring' ? ['pond'] : ['pond', 'withered-lotus']);
    addVisibleTags(pond.x, pond.waterY || 0.8, pond.z, pTags, 1.75, 130);
  }

  // 5. 竹林、桑林、桃花林
  const bamboos = ctx.village?.bamboo;
  if (Array.isArray(bamboos)) {
    const step = bamboos.length > 48 ? 3 : 1;
    for (let i = 0; i < bamboos.length; i += step) {
      addVisibleTags(bamboos[i][0], NaN, bamboos[i][1], ['bamboo'], 1.15, 140);
    }
  }
  const mulberries = ctx.village?.mulberry;
  if (Array.isArray(mulberries)) {
    const step = mulberries.length > 36 ? 2 : 1;
    for (let i = 0; i < mulberries.length; i += step) {
      addVisibleTags(mulberries[i][0], NaN, mulberries[i][1], ['mulberry'], 1.15, 140);
    }
  }
  const floraSpots = ctx.flora?.nearSpots?.length ? ctx.flora.nearSpots : ctx.flora?.spots;
  if (Array.isArray(floraSpots)) {
    const step = floraSpots.length > 60 ? 3 : 1;
    for (let i = 0; i < floraSpots.length; i += step) {
      const s = floraSpots[i];
      const t = phenologyId === 'spring' ? ['peach', 'petals'] : (phenologyId === 'winter' ? [] : ['peach']);
      if (t.length) addVisibleTags(s[0], s[1] + 1.5, s[2], t, 1.15, 135);
    }
  }

  // 6. 武陵溪流、山洞与泛舟
  const riverPts = ctx.riverSpine || world?.stream?.points;
  if (Array.isArray(riverPts)) {
    const step = riverPts.length > 40 ? 4 : 1;
    for (let i = 0; i < riverPts.length; i += step) {
      const rp = riverPts[i];
      const rx = Array.isArray(rp) ? rp[0] : rp.x;
      const rz = Array.isArray(rp) ? rp[1] : rp.z;
      const rTags = phenologyId === 'winter' ? ['stream', 'shore-ice'] : ['stream'];
      addVisibleTags(rx, world?.terrain?.waterLevel || 0.2, rz, rTags, 1.1, 140);
    }
  }
  if (ctx.cliff?.slit) {
    addVisibleTags(ctx.cliff.slit.x, (ctx.cliff.slit.ground || 0) + 1.5, ctx.cliff.slit.z, ['cave'], 2.1, 70);
  }
  const boatChildren = ctx.boats?.group?.children;
  if (Array.isArray(boatChildren)) {
    for (let i = 0; i < boatChildren.length; i++) {
      const m = boatChildren[i];
      if (m?.position && /^boat-\d+$/.test(m.name || '')) {
        addVisibleTags(m.position.x, m.position.y + 0.4, m.position.z, ['boat', 'stream'], 1.45, 100);
      }
    }
  }

  const aboardSkiff = Boolean(riverSkiff?.isAboard?.() || player?.state?.aboardSkiff);
  const skiffDrifting = Boolean(aboardSkiff && riverSkiff?.getStats?.()?.drifting);
  if (aboardSkiff) {
    addTagScore('skiff-aboard', 3.4);
    addTagScore('boat', 2.8);
    addTagScore('stream', 2.4);
    if (skiffDrifting) addTagScore('skiff-drifting', 2.8);
  }

  // 7. 谷缘地标
  const vb = ctx.valleyBorderlands?.layout;
  if (vb) {
    if (vb.cloudPavilion) addVisibleTags(vb.cloudPavilion.x, vb.cloudPavilion.y + 1.8, vb.cloudPavilion.z, ['cloud-pavilion', 'pavilion'], 2.2, 140);
    if (vb.sunningTerrace) addVisibleTags(vb.sunningTerrace.x, vb.sunningTerrace.y + 0.6, vb.sunningTerrace.z, ['sunning'], 2.2, 110);
    if (vb.ancientStele) addVisibleTags(vb.ancientStele.x, vb.ancientStele.y + 1.0, vb.ancientStele.z, ['ancient-stele'], 2.4, 90);
    if (vb.watchtower) addVisibleTags(vb.watchtower.x, vb.watchtower.y + 2.5, vb.watchtower.z, ['watchtower'], 2.2, 130);
    if (vb.stoneBridge) addVisibleTags(vb.stoneBridge.x, vb.stoneBridge.y + 0.8, vb.stoneBridge.z, ['bridge'], 1.8, 100);
    if (vb.waterfall) addVisibleTags(vb.waterfall.x, (vb.waterfall.poolWaterY || 2) + 3.0, vb.waterfall.z, ['waterfall'], 2.4, 140);
  }

  // 8. 村人与走兽飞禽
  const peopleList = ctx.people?.list;
  if (Array.isArray(peopleList)) {
    for (let i = 0; i < peopleList.length; i++) {
      const p = peopleList[i];
      const pTags = ['villagers'];
      if (p.role === 'child') pTags.push('children');
      else if (p.role === 'elder') pTags.push('elders');
      addVisibleTags(p.x, NaN, p.z, pTags, 0.95, 70);
    }
  }
  const animals = ctx.fauna?.animals;
  if (Array.isArray(animals)) {
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (a?.kind && TARGET_ID_TAGS[a.kind]) {
        addVisibleTags(a.x, (a.y || 0) + 0.4, a.z, TARGET_ID_TAGS[a.kind], 1.15, 65);
      }
    }
  }

  // 9. 视野内相邻景域感知（例如立于「良田」眺望「美池」「六博亭林」）
  const secondaryRegions = [];
  const allRegions = buildExpandedRegionList(world, ctx);
  for (let i = 0; i < allRegions.length; i++) {
    const rg = allRegions[i];
    if (!rg || rg.name === region) continue;
    const dist = Math.hypot(rg.x - basis.posX, rg.z - basis.posZ);
    if (dist > 135) continue;
    const w = projectVis(rg.x, NaN, rg.z, 135);
    if (w > 0.25) {
      secondaryRegions.push({ name: rg.name, weight: w });
    }
  }
  secondaryRegions.sort((a, b) => b.weight - a.weight);

  // 10. 若无 SceneContext 传入（如精简单元测试），依据所处景域补足基本实景意象
  if (tagScores.size === 0) {
    if (region === '良田' || region === '阡陌') {
      addTagScore(phenologyId === 'autumn' ? 'millet' : (phenologyId === 'winter' ? 'field' : 'paddy'), 2.2);
      addTagScore('field', 1.8);
      if (isNight) addTagScore('warm-lights', 1.2);
    } else if (region === '美池') {
      addTagScore('pond', 2.5);
      addTagScore(phenologyId === 'summer' ? 'lotus' : 'withered-lotus', 2.0);
    } else if (region === '武陵溪' || region === '水源') {
      addTagScore('stream', 2.5);
      addTagScore('boat', 1.5);
      if (phenologyId === 'winter') addTagScore('ferry', 1.8);
    } else if (region === '桃花林') {
      addTagScore('peach', 2.5);
      if (phenologyId === 'spring') addTagScore('petals', 2.0);
    } else if (region === '山口' || region === '初极狭' || region === '豁然开朗') {
      addTagScore('cave', 2.4);
    } else if (region === '桑竹' || region === '六博亭林') {
      addTagScore('bamboo', 2.2);
      addTagScore('pavilion', 1.8);
    } else if (region === '桃源村' || region === '人家') {
      addTagScore('village', 2.2);
      addTagScore('cottage', 2.0);
      if (isNight || isDusk) addTagScore('warm-lights', 1.8);
    }
  }

  // 11. 氛围、流萤、篝火、虹霓、秋雁、天象与视角感知
  const inCave = region === '初极狭' || region === '山口';
  const gatherStats = ctx.seasonalGathering?.getStats?.();
  const nearVillageValley = basis.posZ < -20 && basis.posZ > -260;
  const nearFireflyZone = Boolean(
    (tagScores.get('paddy') || 0) > 0.4 ||
    (tagScores.get('pond') || 0) > 0.4 ||
    (tagScores.get('bamboo') || 0) > 0.4 ||
    (tagScores.get('cottage') || 0) > 0.4 ||
    region === '良田' || region === '美池' || region === '桃源村' || region === '竹坞药庐'
  );
  if ((phenologyId === 'summer' || phenologyId === 'spring') && (isNight || isDusk) && !isRain && !isSnow && !inCave) {
    if (gatherStats?.fireflyActive || (nearVillageValley && nearFireflyZone)) {
      addTagScore('fireflies', phenologyId === 'summer' ? 2.4 : 1.3);
    }
  }

  const feastState = ctx.qinHanCompletion?.getNightFeastState?.();
  if (feastState?.active && !isRain) {
    const fw = projectVis(feastState.x, feastState.y + 1, feastState.z, 95);
    if (fw > 0) {
      addTagScore('bonfire', fw * 2.2);
      addTagScore('feast', fw * 1.9);
    }
  }

  const cycleStats = ctx.seasonalCycle?.getStats?.();
  if (cycleStats?.rainbowVisible && basis.pitch > -0.25 && !inCave) {
    addTagScore('rainbow', 3.2);
  }
  if (cycleStats?.geeseVisible && basis.pitch > -0.25 && !inCave) {
    addTagScore('geese', 3.0);
  }

  if (!inCave) {
    if (isNight && !isRain && !isSnow && basis.pitch > -0.28) {
      const pitchBoost = basis.pitch > 0.1 ? 1.35 : 1.0;
      if (weatherId === 'clear' || isWind) {
        addTagScore('stars', 1.85 * pitchBoost);
        addTagScore('milky-way', 1.55 * pitchBoost);
      }
      addTagScore('moon', 1.15 * pitchBoost);
      if (lunarName.includes('望') || lunarName.includes('盈')) addTagScore('full-moon', 1.3 * pitchBoost);
      else if (lunarName.includes('蛾眉') || lunarName.includes('朔') || lunarName.includes('残')) addTagScore('crescent-moon', 1.3 * pitchBoost);
    }
    if (isDawn && !isRain) addTagScore('sunrise', 1.6);
    if (isDusk && !isRain) addTagScore('sunset', 1.6);
    if (isRain) addTagScore('rain', 2.2);
    if (isMist) addTagScore('mist-sea', 2.1);
    if (isWind) addTagScore('wind', 1.6);
    if (isSnow || phenologyId === 'winter') addTagScore('snow', isSnow ? 2.6 : 1.2);
    if (basis.pitch > -0.22 && !isRain) addTagScore('mountains', 1.25);
    if (weatherId === 'clear' || isMist) addTagScore('clouds', isMist ? 1.6 : 1.0);
  }

  if (godFlight?.active || basis.elevation > 12) {
    addTagScore('aerial', 3.4);
  }
  if (basis.pitch > 0.34 && !inCave) {
    addTagScore('skyward', 2.4);
  }

  const sortedTags = Array.from(tagScores.entries()).sort((a, b) => b[1] - a[1]);
  const topTags = sortedTags.slice(0, 10).map(([tag]) => tag);
  const detectedFeatures = [];
  for (let i = 0; i < sortedTags.length && detectedFeatures.length < 6; i++) {
    const label = SCENE_TAG_LABELS[sortedTags[i][0]];
    if (label && !detectedFeatures.includes(label)) detectedFeatures.push(label);
  }

  return {
    region: region || '桃花源',
    secondaryRegions: secondaryRegions.slice(0, 3).map(s => s.name),
    phenologyId,
    timeId,
    weatherId,
    solarTerm,
    lunarName,
    elevation: Math.round(basis.elevation * 10) / 10,
    pitch: Math.round(basis.pitch * 100) / 100,
    aboardSkiff,
    skiffDrifting,
    tags: Object.fromEntries(sortedTags),
    topTags,
    detectedFeatures
  };
}

function isColophonCompatible(entry, sceneProfile) {
  const { phenologyId, timeId, weatherId, tags } = sceneProfile;
  if (entry.avoidPhenology?.includes(phenologyId)) return false;
  if (entry.avoidTime?.includes(timeId)) return false;
  if (entry.avoidWeather?.includes(weatherId)) return false;

  if (entry.requiresTag && !(tags?.[entry.requiresTag] > 0)) return false;

  // 严格校验物候与天时：明确限定了物候或天时的词句绝不越季、越昼夜出现
  if (entry.matchPhenology?.length && !entry.matchPhenology.includes(phenologyId)) {
    return false;
  }
  if (entry.matchTime?.length && !entry.matchTime.includes(timeId)) {
    return false;
  }

  // 专咏雨/雪/雾或晴空天象句的天气相容性
  const mw = entry.matchWeather;
  if (mw?.length) {
    if (mw.includes('snow') && !mw.includes('clear') && weatherId !== 'snow') return false;
    if (mw.includes('rain') && !mw.includes('clear') && !mw.includes(weatherId)) return false;
    if (mw.includes('mist') && !mw.includes('clear') && !mw.includes(weatherId)) return false;
    if (mw.length === 1 && mw[0] === 'clear' && (weatherId === 'rain' || weatherId === 'snow')) return false;
  }
  const entryTags = entry.matchTags || entry.tags || [];
  if (
    (weatherId === 'rain' || weatherId === 'snow') &&
    !mw?.includes(weatherId) &&
    entryTags.some(t => t === 'stars' || t === 'milky-way' || t === 'moon' || t === 'full-moon' || t === 'crescent-moon' || t === 'rainbow' || t === 'sunrise' || t === 'sunset')
  ) {
    return false;
  }
  return true;
}

function scoreEntry(entry, sceneProfile) {
  let score = Number(entry.priority) || 0;
  const { region, secondaryRegions, phenologyId, timeId, weatherId, solarTerm, tags } = sceneProfile;

  // 1. 区域精准命中（主导地标与当前景域权重最高）
  const primaryRegionMatch = Boolean(entry.matchRegions?.includes(region));
  const secondaryRegionMatch = Boolean(!primaryRegionMatch && entry.matchRegions?.some(r => secondaryRegions?.includes(r)));
  if (primaryRegionMatch) {
    score += 7.5;
  } else if (secondaryRegionMatch) {
    score += 3.2;
  }

  // 2. 物候专属性小幅加分（专季句略高于泛季句，但不压倒地标与画面景物）
  if (entry.matchPhenology?.length && entry.matchPhenology.includes(phenologyId)) {
    score += entry.matchPhenology.length <= 2 ? 1.8 : 0.8;
  }

  // 3. 天时专属性小幅加分
  if (entry.matchTime?.length && entry.matchTime.includes(timeId)) {
    score += entry.matchTime.length <= 2 ? 1.8 : 0.8;
  }

  // 4. 天气专属性加分与微调
  if (entry.matchWeather?.length) {
    if (entry.matchWeather.includes(weatherId)) {
      if (weatherId === 'snow' || weatherId === 'rain' || weatherId === 'mist') {
        score += entry.matchWeather.length <= 2 ? 2.6 : 1.4;
      } else {
        score += entry.matchWeather.length <= 2 ? 1.5 : 0.7;
      }
    } else {
      score -= 1.0;
    }
  }

  // 5. 节气点睛
  const solarMatch = Boolean(solarTerm && entry.matchSolarTerms?.includes(solarTerm));
  if (solarMatch) {
    score += 3.2;
  }

  // 6. 3D 视锥实景意象精准共振（多意象同时在画面中时触发共振加分）
  let matchedTags = 0;
  let tagScoreSum = 0;
  if (entry.matchTags?.length && tags) {
    for (let i = 0; i < entry.matchTags.length; i++) {
      const t = entry.matchTags[i];
      const tw = tags[t];
      if (tw > 0) {
        matchedTags++;
        tagScoreSum += Math.min(2.6, tw) * 1.9;
      }
    }
    score += tagScoreSum;
    if (matchedTags >= 2) score += (Math.min(4, matchedTags) - 1) * 2.15;
    // 特殊视角与稀有天象（凌虚航拍、泛舟随波、晴虹、南雁）显性共振加权
    if ((tags.aerial || 0) > 0 && entry.matchTags.includes('aerial')) score += 12.0;
    if ((tags['skiff-aboard'] || 0) > 0 && entry.matchTags.includes('skiff-aboard')) score += 9.0;
    if ((tags['skiff-drifting'] || 0) > 0 && entry.matchTags.includes('skiff-drifting')) score += 6.0;
    if ((tags.rainbow || 0) > 0 && entry.matchTags.includes('rainbow')) score += 10.0;
    if ((tags.geese || 0) > 0 && entry.matchTags.includes('geese')) score += 9.0;
    if (entry.requiresTag && WILDS_WONDER_TAGS.has(entry.requiresTag)) {
      const wScore = tags[entry.requiresTag] || 0;
      if (wScore > 0) score += 18.0 + Math.min(4.8, wScore) * 2.5;
    }
  }

  const isStrongSceneMatch = Boolean(
    primaryRegionMatch ||
    secondaryRegionMatch ||
    solarMatch ||
    matchedTags >= 2 ||
    (matchedTags >= 1 && score >= 6.5)
  );

  return { score, matchedTags, isStrongSceneMatch };
}

function pickCleanSeal(u, l, fallbackTag, avoidSeals = null) {
  const s1 = String(u.seal2 || '');
  const s2 = String(l.seal2 || '');
  const isOk = (s) => s && (!avoidSeals || !avoidSeals.has(s));
  if (s1.length === 2 && s2.length === 2) {
    const combined = s1 + s2;
    if (new Set(Array.from(combined)).size === 4 && isOk(combined)) return combined;
  }
  const candTags = [...l.tags, ...u.tags, fallbackTag];
  for (let i = 0; i < candTags.length; i++) {
    const fb = TAG_FALLBACK_SEAL[candTags[i]];
    if (fb && isOk(fb)) return fb;
  }
  return TAG_FALLBACK_SEAL[fallbackTag] || '桃源清赏';
}

function hasSharedHanzi(a, b) {
  const setA = new Set(Array.from(String(a).replace(/[，。；！？、\s]/g, '')));
  const charsB = Array.from(String(b).replace(/[，。；！？、\s]/g, ''));
  for (let i = 0; i < charsB.length; i++) {
    if (setA.has(charsB[i])) return true;
  }
  return false;
}

export function composeContextualColophons(sceneProfile, { limit = 6, recentVerses = [], savedVerses = [], avoidSeals = null } = {}) {
  if (!sceneProfile) return [];
  const tags = sceneProfile.tags || {};
  const knownVerses = new Set(CLASSICAL_COLOPHONS.map(c => c.verse));
  const usedRecent = new Set([...recentVerses, ...savedVerses]);
  const takenSeals = new Set(avoidSeals || []);

  const scoreHalf = (half) => {
    if (!isColophonCompatible(half, sceneProfile)) return -Infinity;
    // 主意象（tags[0]）必须真实出现在画心视锥中，杜绝无水自咏瀑、无虹自咏虹
    const anchorTag = half.tags[0];
    if (!anchorTag || !(tags[anchorTag] > 0)) return -Infinity;

    let s = 0;
    let bestTag = anchorTag;
    let bestTagScore = tags[anchorTag];
    for (let i = 0; i < half.tags.length; i++) {
      const t = half.tags[i];
      const tw = tags[t] || 0;
      if (tw > 0) {
        s += Math.min(2.6, tw) * 1.8;
        if (tw > bestTagScore) {
          bestTagScore = tw;
          bestTag = t;
        }
      }
    }
    if (s <= 0) return -Infinity;
    if (half.matchPhenology?.includes(sceneProfile.phenologyId)) s += 1.6;
    if (half.matchTime?.includes(sceneProfile.timeId)) s += 1.6;
    if (half.matchWeather?.includes(sceneProfile.weatherId)) s += 1.4;
    return { score: s, primaryTag: bestTag || anchorTag };
  };

  const uppers = [];
  for (let i = 0; i < COMPOSE_UPPER_LINES.length; i++) {
    const u = COMPOSE_UPPER_LINES[i];
    const r = scoreHalf(u);
    if (r !== -Infinity) uppers.push({ item: u, ...r });
  }
  const lowers = [];
  for (let i = 0; i < COMPOSE_LOWER_LINES.length; i++) {
    const l = COMPOSE_LOWER_LINES[i];
    const r = scoreHalf(l);
    if (r !== -Infinity) lowers.push({ item: l, ...r });
  }

  const candidates = [];
  for (let ui = 0; ui < uppers.length; ui++) {
    const u = uppers[ui];
    for (let li = 0; li < lowers.length; li++) {
      const l = lowers[li];
      if (u.item.meter !== l.item.meter) continue;
      if (u.primaryTag === l.primaryTag && sceneProfile.topTags?.length > 1) continue;
      if (hasSharedHanzi(u.item.text, l.item.text)) continue;
      const verse = `${u.item.text}，${l.item.text}。`;
      if (knownVerses.has(verse)) continue;
      if (FORBIDDEN_PLACE_NAMES.some(bad => verse.includes(bad))) continue;
      let total = u.score + l.score + (u.primaryTag !== l.primaryTag ? 1.8 : 0);
      if (usedRecent.has(verse)) total -= 6.0;
      candidates.push({
        id: `composed-${hashText(verse).toString(36)}`,
        verse,
        uItem: u.item,
        lItem: l.item,
        primaryTag: u.primaryTag,
        composed: true,
        meter: u.item.meter,
        matchedTags: 2,
        isStrongSceneMatch: true,
        score: total
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  const usedUppers = new Set();
  const usedLowers = new Set();
  for (let i = 0; i < candidates.length && picked.length < limit; i++) {
    const c = candidates[i];
    const [uPart, lPart] = c.verse.replace(/。$/, '').split('，');
    if (usedUppers.has(uPart) || usedLowers.has(lPart)) continue;
    usedUppers.add(uPart);
    usedLowers.add(lPart);
    const seal = pickCleanSeal(c.uItem, c.lItem, c.primaryTag, takenSeals);
    takenSeals.add(seal);
    picked.push({
      id: c.id,
      verse: c.verse,
      seal,
      composed: true,
      meter: c.meter,
      matchedTags: c.matchedTags,
      isStrongSceneMatch: true,
      score: c.score
    });
  }
  return picked;
}

export function buildScrollColophonQueue(
  sceneProfile,
  {
    recentIds = [],
    savedVerses = [],
    seed = 0,
    includeComposed = true,
    composedLimit = 5
  } = {}
) {
  const recentSet = new Set(recentIds || []);
  const savedSet = new Set(savedVerses || []);
  const curatedScored = [];

  for (let i = 0; i < CLASSICAL_COLOPHONS.length; i++) {
    const entry = CLASSICAL_COLOPHONS[i];
    if (!isColophonCompatible(entry, sceneProfile)) continue;
    const { score, matchedTags, isStrongSceneMatch } = scoreEntry(entry, sceneProfile);
    let finalScore = score;
    const wasUsed = recentSet.has(entry.id) || recentSet.has(entry.verse) || savedSet.has(entry.verse);
    if (recentSet.has(entry.id) || recentSet.has(entry.verse)) finalScore -= 14.0;
    else if (savedSet.has(entry.verse)) finalScore -= 8.0;

    curatedScored.push({
      ...entry,
      libraryIndex: i,
      composed: false,
      baseScore: score,
      matchedTags,
      isStrongSceneMatch,
      wasUsed,
      sortScore: finalScore
    });
  }

  curatedScored.sort((a, b) => b.sortScore - a.sortScore || a.libraryIndex - b.libraryIndex);

  // 签名级唯美首推判断（例如冬雪武陵渡口「寒江渔火」遥遥领先且未被最近使用，则稳稳居首）
  const top0 = curatedScored[0];
  const top1 = curatedScored[1];
  const isSignatureLead = Boolean(
    top0 && !top0.wasUsed && (!top1 || (top0.sortScore - top1.sortScore) >= 2.8)
  );

  // 同梯队近分佳句之间按位姿/次数微调次序，避免同地每次拍出完全千篇一律的句首
  if (!isSignatureLead && curatedScored.length > 2) {
    const bandTop = curatedScored[0].sortScore - 1.85;
    let bandEnd = 1;
    while (bandEnd < Math.min(8, curatedScored.length) && curatedScored[bandEnd].sortScore >= bandTop) {
      bandEnd++;
    }
    if (bandEnd > 1) {
      const slice = curatedScored.slice(0, bandEnd);
      const shift = Math.abs(Math.floor(seed)) % slice.length;
      if (shift > 0) {
        const rotated = slice.slice(shift).concat(slice.slice(0, shift));
        for (let k = 0; k < rotated.length; k++) curatedScored[k] = rotated[k];
      }
    }
  }

  let items = curatedScored;
  if (includeComposed) {
    const topCuratedSeals = new Set(curatedScored.slice(0, 14).map(c => c.seal));
    const composed = composeContextualColophons(sceneProfile, {
      limit: composedLimit,
      recentVerses: Array.from(recentSet),
      savedVerses: Array.from(savedSet),
      avoidSeals: topCuratedSeals
    });
    if (composed.length) {
      const merged = curatedScored.slice();
      // 将即景对联穿插在榜单第 2, 5, 8, 11, 14 位，既保首幅典雅原诗又在翻阅题跋时频现贴景新联
      for (let i = 0; i < composed.length; i++) {
        const insertAt = Math.min(merged.length, 1 + i * 3);
        merged.splice(insertAt, 0, composed[i]);
      }
      items = merged;
    }
  }

  if (items.length === 0 && CLASSICAL_COLOPHONS.length > 0) {
    items = [{
      ...CLASSICAL_COLOPHONS[0],
      libraryIndex: 0,
      composed: false,
      isStrongSceneMatch: false,
      sortScore: 0
    }];
  }

  let strongMatchCount = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].isStrongSceneMatch) strongMatchCount++;
  }

  return {
    items,
    strongMatchCount,
    libraryCount: CLASSICAL_COLOPHONS.length
  };
}
