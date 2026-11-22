// Rich contextual multi-turn villager dialogue director for Taohuayuan.
// Strictly preserves Act 1/2 lore and excludes all Act 3 spoilers.
import wildsEggsCfg from '../data/wilds-easter-eggs.json' with { type: 'json' };

const SURNAMES = ['田', '周', '苏', '柳', '沈', '陆', '季', '辛', '陶', '徐', '范', '程', '蔡', '贺'];
const APPEL_ELDER = ['老丈', '阿翁', '长者', '阿伯'];
const APPEL_WOMAN = ['阿婶', '大嫂', '阿婆', '阿姑'];
const APPEL_MAN = ['三哥', '大叔', '阿兄', '老哥'];
const APPEL_CHILD = ['小哥儿', '阿毛', '丫头', '小娃'];
const TRAITS = ['敦厚和气', '健谈爽朗', '勤谨沉稳', '爱听外事', '语调慢热'];

// 二十四节气农事与村俗语库（严格承接晋时田园风物，不含任何第三幕剧透）
const SOLAR_TERM_LORE = {
  小寒: {
    greet: '小寒天冷，山中落了薄雪，各家火塘早早添旺了松柴哩。',
    farming: '小寒进腊月，水田早已封霜歇犁，大伙趁农闲修整木锄曲犁、补好竹匾鱼筌，给牛栏厚铺干稻草挡寒。',
    closing: '小寒虽冷，屋里火塘温着醪酒芋艿，老少围坐闲话，倒比外面暖和得多。'
  },
  大寒: {
    greet: '大寒岁暮风紧，檐下薄雪映日，村舍炊烟飘得最暖和。',
    farming: '大寒是岁末最冷的辰光，田亩休养地力，家家晒好腊肉腌菜、筛净留种的金粟，静候东风解冻开春。',
    closing: '大寒一过便近立春，熬过这几日寒气，溪畔柳梢很快就要返青啰。'
  },
  立春: {
    greet: '今岁刚交立春，东风解了溪边薄冻，柳条都暗暗抽出嫩芽啦。',
    farming: '立春过后地气回暖，村人先把农具搬到院里上松脂油、修好田埂沟渠，再拣出饱满谷种晾晒备耕。',
    closing: '一年之计在于春，立春迎得暖风来，往后田畴桑竹便日日有生机。'
  },
  雨水: {
    greet: '雨水时节空气润得很，山涧泉水渐活，竹筒车转得越发轻快。',
    farming: '雨水贵如油，田里引山泉润透冬泥，老农开始套牛浅耕备墒，妇人也忙着清扫蚕室、晾晒桑筐。',
    closing: '春雨润物无声，田土吃饱了水，今年春苗准保长势喜人。'
  },
  惊蛰: {
    greet: '惊蛰一到草木苏醒，桃枝已满含红蕾，池塘泥底也渐有生息。',
    farming: '惊蛰前后春耕正式开张！东垄清早便套上水牛翻耕熟土，菜畦撒下瓜豆菘菜籽，鸡鸭也满坡刨虫吃。',
    closing: '惊蛰一声醒百虫，田间人声牛哞相和，整个山谷都活泛起来了。'
  },
  春分: {
    greet: '春分昼夜平分，夹岸桃花初绽，草地软得踩上去全无寒意。',
    farming: '春分暖湿恰好，村里趁晴播下早稻秧种，修剪后坡桑枝；妇人提着竹篮采嫩荠菜做饼，香透半条街。',
    closing: '春分风软日和，桃林芳草鲜美，正是踏青赏花、勤理春田的好光景。'
  },
  清明: {
    greet: '正值清明时节，桃林落英飘得满径都是，村口溪水也暖和起来了。',
    farming: '清明前后种瓜点豆，水牛一早便拉曲木犁翻熟春泥；妇人拾掇蚕匾织麻，孩童折了嫩柳插在门楣上祈个岁安。',
    closing: '清明风清景明，桃瓣随溪水流过木桥，咱们山中人只盼年年风调雨顺。'
  },
  谷雨: {
    greet: '眼下刚进谷雨，山间润气正足，家家忙着播秧采头茬春茶哩。',
    farming: '谷雨最宜采春茶与育秧！后山茶坡新芽肥厚，炒出来清香甘润；水田引溪灌满，过几日便能起秧移栽啰。',
    closing: '雨生百谷，谷雨过罢桑叶也长齐了，春蚕上簇、新茶入瓮，满村都是清香。'
  },
  立夏: {
    greet: '立夏南风一吹，满坡桑叶肥厚翠绿，树荫底也渐显清凉啦。',
    farming: '立夏农事紧，东边水田忙着蓄水插早秧，西郊妇人天不亮便提筐采桑喂春蚕，院里织机咔哒响到日落。',
    closing: '立夏万物并秀，看田里秧苗日日拔节、蚕宝宝沙沙食叶，心里头最踏实。'
  },
  小满: {
    greet: '小满时节麦穗初盈，竹林里头已有早蝉试着鸣了两声哩。',
    farming: '小满动三车——溪边筒车日夜提水灌高田，院里缫车抽新丝，石碓踏着舂新麦，家家户户都忙得脚不沾地。',
    closing: '麦粒小满未全盈，山里人做事也讲究留三分余地，从容过日子才长久。'
  },
  芒种: {
    greet: '芒种一到最是农忙，东垄秧苗刚插齐，池塘新荷也探出水面了。',
    farming: '芒种又称忙种：趁这几日雨水丰沛，男丁弯腰抢插晚稻、收割早麦，晌午只在瓜庐荫下喝碗凉泉歇半刻。',
    closing: '芒种流尽田间汗，换来秋日满仓粮；歇晚了去水亭吹吹荷风，乏气全消。'
  },
  夏至: {
    greet: '夏至白日最长，满池红荷正艳，往竹荫水亭下走最是凉爽。',
    farming: '夏至秧苗已稳，每日只需看护水口深浅、拔除田埂杂草；日头最毒时大伙歇在瓜庐或社树荫里下六博避暑。',
    closing: '夏至昼长夜短，听着蝉声蛙鸣、吹着荷塘清风，山中岁月静得像停住一般。'
  },
  小暑: {
    greet: '小暑熏风阵阵，水车吱呀送凉，大伙趁清早凉快下田除草哩。',
    farming: '小暑田禾最喜温热与活水，筒车和竹枧昼夜不停引溪润田；家家趁烈日把陈谷、书籍与葛布搬到晒场翻晾。',
    closing: '小暑虽热，溪畔竹林浓荫遮日，汲一桶深井凉泉湃上甜瓜最解暑气。'
  },
  大暑: {
    greet: '大暑蝉鸣满竹林，老水牛一早就泡进浅塘泥水里躲日头啰。',
    farming: '大暑日头烈，庄稼人辰时前便把锄草追肥的活做完，午间全歇在茅亭瓜庐纳凉，傍晚再浇灌菜畦。',
    closing: '大暑蒸出稻花香，忍得几日酷暑，田里的谷穗便能灌满浆水哩。'
  },
  立秋: {
    greet: '立秋过后云淡天高，早晚已带丝丝凉意，稻穗渐泛微金啦。',
    farming: '立秋看田色，早稻开始抽穗扬花，农人紧着疏通排水沟、防秋风倒伏，菜园里也趁凉补种秋菘萝卜。',
    closing: '一叶落而知秋，立秋晚风拂过晒场，蝉声渐歇，秋虫便要接替奏曲了。'
  },
  处暑: {
    greet: '处暑暑气渐收，傍晚山谷常铺满晚霞，田头风吹着可舒坦。',
    farming: '处暑稻粟日渐饱满，田头扎好草人护住谷穗防雀啄，家家把晒谷坪扫净压实，预备过阵子开镰收割。',
    closing: '处暑天高气爽，稻穗低头、晚霞映溪，正是登高望远的好时节。'
  },
  白露: {
    greet: '白露清晨草叶凝珠，溪畔蒹葭微凉，满畴秋禾都沉甸甸了。',
    farming: '白露秋分夜，一夜冷一夜。村里忙着采摘秋茶、收晒早熟谷豆，院角瓦瓮也酿起了甜醇的新米醪酒。',
    closing: '白露生凉，趁日暖多晒几匾干菜干果，入冬灶上便不愁鲜味。'
  },
  秋分: {
    greet: '秋分一过平畴金粟低垂，晒场这几日全飘着新谷稻香哩。',
    farming: '秋分正是秋收大忙！东垄西畴镰声沙沙，独轮木车一车车把金粟推上晒场脱粒扬糠，老少脸上全挂着笑。',
    closing: '春种一粒粟，秋收万颗子；秋分满坪金谷晒透入仓，心里最是安稳。'
  },
  寒露: {
    greet: '寒露露重草寒，后坡乌桕和枫林都初染丹砂，好看得很呢。',
    farming: '寒露抢收晚稻与山果，男丁忙着翻耕冬闲地种冬麦，老丈们则去山坡采摘甘菊与霜桑叶晒干留着冬日煎茗。',
    closing: '寒露枫红菊黄，登临北岭观云亭看一层层霜林，满谷都像画卷一样。'
  },
  霜降: {
    greet: '霜降晓霜覆檐，东篱野菊开得正艳，后坡霜叶全红透了。',
    farming: '霜降前得把地里最后一批晚粟与薯芋收尽入窖，给茅檐补厚新茅草、修检烟囱土灶，稳稳当当迎冬天。',
    closing: '霜叶红于二月花，霜降赏罢秋菊饮盏新醅，一年的辛劳便算圆满收尾。'
  },
  立冬: {
    greet: '立冬水落石出，归鸟早早栖上林梢，山谷静得能听见落叶声。',
    farming: '立冬补冬藏粮：谷仓封实、干柴码满屋檐底，水牛添足干草精料入暖栏，大伙卸下重活准备过冬歇。',
    closing: '立冬万物闭藏，田亩休耕养肥，村人也趁冬闲访邻小酌、击缶唱谣。'
  },
  小雪: {
    greet: '小雪山岚清冷，偶有零星薄雪拂过檐角，屋里炉火初温哩。',
    farming: '小雪封地前给菜畦覆上枯草保温，家家腌制冬菜、烘烤干笋，夜里火塘边捻麻补网，一点也不觉闷。',
    closing: '小雪初寒茶正热，来村口草寮或屋檐下喝碗温姜茗，浑身都暖融融的。'
  },
  大雪: {
    greet: '大雪时节山中落了薄雪，田畴歇犁、老牛入栏，家家火塘煨着热芋与温酒哩。',
    farming: '俗话说瑞雪兆丰年，大雪盖实冬麦冻死田间虫卵，开春化水最润土；村人趁雪闲修补犁锄、围炉叙旧。',
    closing: '大雪覆满千山茅檐，屋里火光橘暖、瓦瓮茶香袅袅，正是山中清静好时光。'
  },
  冬至: {
    greet: '今日冬至岁寒日短，薄雪映着暖灯，早早添旺火塘温酒最舒坦。',
    farming: '冬至一阳生，村里早封了田犁，灶上慢炖走地肥鸡与新芋，亲邻互赠米糕醪酒，夜里围炉拍缶听古谣。',
    closing: '冬至大如年，过了今日白昼便渐渐拉长，转眼又是一年桃花满溪啰。'
  }
};

function hashKey(str = '') {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function pickFrom(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function leadSolarText(term, text) {
  if (!text) return '';
  return text.startsWith(term) ? text : `眼下正逢${term}，${text}`;
}

function safeClockText(getWorldClock, sky, getPhenology) {
  const timeId = sky?.timeId || sky?.getAppearance?.()?.timeId || 'day';
  const weatherId = sky?.weatherId || sky?.getAppearance?.()?.weatherId || 'clear';
  const rain = Number(sky?.rainIntensity ?? 0);
  const snow = Number(sky?.snowIntensity ?? 0);
  const st = typeof getWorldClock === 'function' ? getWorldClock()?.getState?.() : null;
  const phId = typeof getPhenology === 'function' ? (getPhenology()?.getStats?.()?.phenologyId || 'spring') : 'spring';
  const seasonWord =
    phId === 'summer' ? '夏木阴阴' :
      phId === 'autumn' ? '秋粟垂金' :
        phId === 'winter' ? '冬岭凝霜' : '春桃芳菲';
  const shichen = st?.shichenName || st?.short || st?.shichen || (
    timeId === 'dawn' ? '卯正' :
      timeId === 'dusk' ? '酉正' :
        timeId === 'night' ? '亥初' : '巳初'
  );
  const defaultSolarTerm =
    phId === 'summer' ? '芒种' :
      phId === 'autumn' ? '秋分' :
        phId === 'winter' ? '大雪' : '清明';
  const solarTerm = (st?.solarTerm && SOLAR_TERM_LORE[st.solarTerm]) ? st.solarTerm : defaultSolarTerm;
  const solarLore = SOLAR_TERM_LORE[solarTerm] || SOLAR_TERM_LORE.清明;
  const timeWord =
    timeId === 'dawn' ? '清晨薄光' :
      timeId === 'dusk' ? '暮色将合' :
        timeId === 'night' ? '夜静月朗' : '日头正好';
  const weatherWord =
    (snow > 0.25 || weatherId === 'snow') ? '瑞雪纷飞' :
      (rain > 0.28 || weatherId === 'rain') ? '细雨沾衣' :
        weatherId === 'mist' ? '山岚轻笼' :
          weatherId === 'wind' ? '风动竹林' : '晴空朗润';
  return { timeId, weatherId, rain, snow, shichen, solarTerm, solarLore, timeWord, weatherWord, phenologyId: phId, seasonWord };
}

function buildPersona(target) {
  const key = String(target?.key || 'villager');
  const rawRole = target?.ref?.role || '';
  const role = (rawRole && rawRole !== 'villager')
    ? rawRole
    : (target?.ref?.voiceRole || rawRole || 'villager');
  const h = hashKey(key);
  const surname = pickFrom(SURNAMES, h);
  let called;
  if (role.startsWith('child')) {
    called = surname + '家' + pickFrom(APPEL_CHILD, h >>> 3);
  } else if (role === 'washer' || role === 'weaver' || role === 'basket' || role === 'well_drawer' || role === 'tea_picker' || role === 'wuling_herbalist' || role === 'outskirt_gatherer') {
    called = surname + pickFrom(APPEL_WOMAN, h >>> 3);
  } else if (role.includes('elder') || role === 'beekeeper' || role === 'bamboo_artisan' || role === 'carpenter' || role === 'fou_singer' || role === 'herbalist' || role === 'terrace_farmer' || role === 'mountain_tea_host' || role === 'lanke_elder' || role === 'mountain_hermit' || role === 'outskirt_greeter' || role === 'altar_keeper') {
    called = surname + pickFrom(APPEL_ELDER, h >>> 3);
  } else {
    called = surname + pickFrom(APPEL_MAN, h >>> 3);
  }
  const roleLabel = role === 'well_drawer' ? '汲水妇'
    : role === 'herder' ? '牧牛人'
    : role === 'plowman' ? '扶犁农人'
    : role === 'herbalist' ? '采药老丈'
    : role === 'terrace_farmer' ? '北垅老农'
    : role === 'mountain_tea_host' ? '松风茶翁'
    : role === 'tea_picker' ? '采茶山姑'
    : role === 'woodcutter' ? '云岭樵夫'
    : role === 'lanke_elder' ? '烂柯弈叟'
    : role === 'kiln_potter' ? '守窑陶匠'
    : role === 'mountain_hermit' ? '西岭山人'
    : role === 'altar_keeper' ? '社祝老翁'
    : role === 'spring_scholar' ? '北涧书生'
    : role === 'tea_roaster' ? '茶坡山农'
    : role === 'wuling_fisherman' ? '武陵渔父'
    : role === 'wuling_woodcutter' ? '桃溪樵夫'
    : role === 'wuling_herbalist' ? '寻芳采药客'
    : role === 'outskirt_greeter' ? '村口施茶老丈'
    : role === 'outskirt_farmer' ? '村外荷锄田夫'
    : role === 'outskirt_gatherer' ? '西郊采桑妇'
    : null;
  const baseLabel = roleLabel || target?.name || '村人';
  const who = baseLabel === '村人' ? `${called} · 村邻` : `${baseLabel}（${called}）`;
  return {
    key,
    role,
    surname,
    called,
    who,
    trait: pickFrom(TRAITS, h >>> 6),
    seed: h
  };
}

function describeActivity(target, ctx) {
  const ref = target?.ref || {};
  const mode = ref.mode || '';
  const act = ref.activity || ref.task || ref.station?.kind || '';
  if (ref.role === 'plowman' || act === 'plowing') {
    if (ref.winterRest) return '正添上干草照看暖栏里卧刍避寒的老牛';
    if (ref.rainRest || ctx.rain > 0.28) return '正牵牛收犁在田头避雨歇气';
    if (ref.nightRest || mode === 'rest' || ctx.timeId === 'dusk' || ctx.timeId === 'night') {
      return '正倚着曲木犁照看卧刍耕牛';
    }
    return '正双手稳扶曲木犁梢随牛翻垄';
  }
  if (ref.rainChatting || ref.theaterState === 'rain-eave-chat') return '正同邻人在檐下避雨闲话';
  if (ref.rainRest || (ctx.rain > 0.28 && !ref.nightRest)) return '正往檐下避雨';
  if (ref.nightRest || mode === 'sleep' || mode === 'rest') return '忙完一日归家歇息';
  if (ref.role === 'well_drawer' || act === 'well-draw') {
    return ctx.timeId === 'dawn' ? '清晨正临井汲水' : '正扶着井栏提桶汲水';
  }
  if (ref.role === 'herder' || act === 'herding') {
    return ctx.timeId === 'dusk' ? '正执竹梢护牛暮归' : '正握青竹梢看护塘畔耕牛';
  }
  if (act === 'wash' || target?.ref?.role === 'washer') return '停下木杵抬头看你';
  if (act === 'weave' || target?.ref?.role === 'weaver') return '按住织机木梭歇气';
  if (act === 'carpenter' || target?.ref?.role === 'carpenter') return '搁下墨斗拍落松屑';
  if (act === 'bamboo' || target?.ref?.role === 'bamboo_artisan') return '手里仍拈着青竹篾';
  if (act === 'herbalist' || target?.ref?.role === 'herbalist') return '轻扇竹炉检看瓦铫茶汤';
  if (act === 'terrace_farmer' || target?.ref?.role === 'terrace_farmer') return '扶着田塍木锹远望水口';
  if (target?.ref?.role === 'mountain_tea_host') return '正执蒲扇轻煽泥炉松火烹茶';
  if (target?.ref?.role === 'tea_picker') return '正指尖轻捻云雾嫩芽入竹篓';
  if (target?.ref?.role === 'woodcutter') return '正肩挑青松干柴沿山径徐行';
  if (target?.ref?.role === 'lanke_elder') return '正拈起石枰棋子凝神含笑';
  if (target?.ref?.role === 'kiln_potter') return '正俯察龙窑火膛松柴窑温';
  if (target?.ref?.role === 'mountain_hermit') return '正倚着柴扉远望西岭流云';
  if (target?.ref?.role === 'altar_keeper') return '正拂净社坛石柱香灰，守望古樟荫下四时祈福';
  if (target?.ref?.role === 'spring_scholar') return '正临冷泉竹笕展看农桑旧简，不时抬头望云';
  if (target?.ref?.role === 'tea_roaster') return '正执竹扇守在炒茶泥灶旁翻焙青芽';
  const isSnowAct = ctx.snow > 0.25 || ctx.weatherId === 'snow';
  const isWinAct = ctx.phenologyId === 'winter';
  const isWinNightAct = isWinAct && (ctx.timeId === 'night' || ctx.timeId === 'dusk');
  const isWinThawAct = isWinAct && !isSnowAct && ctx.rain <= 0.25 && ctx.timeId === 'day';
  if (target?.ref?.role === 'wuling_fisherman') {
    if (isSnowAct && (ctx.timeId === 'night' || ctx.timeId === 'dusk')) return '正擎伞守在暖亮渔灯旁，俯看寒江飞雪与薄冰溪岸';
    if (isSnowAct) return '正擎伞抖落肩头飞雪，俯看渡口寒溪竹筏与岸畔薄冰';
    if (isWinNightAct) return '正倚着渡口与筏头两盏暖渔灯，细看寒溪冰岸微光';
    if (isWinThawAct) return '正听着亭檐冰凌化水叮咚，检视系缆竹筏与浅滩薄冰';
    return isWinAct ? '正哈着白气检视系缆竹筏、岸冰与檐下冰凌' : '正执竹梭整理渡口晒网';
  }
  if (target?.ref?.role === 'wuling_woodcutter') {
    return isSnowAct ? '正将干松柴束挪进树荫避雪，呵手暖气' : (isWinAct ? '正按住青竹扁担听雪岭松风' : '正按住青竹扁担歇肩听溪');
  }
  if (target?.ref?.role === 'wuling_herbalist') {
    return isSnowAct ? '正于苔石雪隙间细寻傲雪野山茶' : (isWinAct ? '正俯身辨认霜苔下的冬令草根' : '正挎着采药竹篮俯看溪草');
  }
  if (target?.ref?.role === 'outskirt_greeter') {
    if (isSnowAct) return '正守着冒热气的姜桑茗瓦瓮，捧碗笑迎风雪行客';
    if (isWinNightAct) return '正挑亮草寮暖灯，守着滚热陈桑姜茗候客驱寒';
    if (isWinThawAct) return '正听着茅檐玉箸化水轻响，守着温热姜茗瓦瓮笑迎';
    return isWinAct ? '正添旺温茶炭火，在挂满冰凌的草寮前笑迎' : '正捧着粗陶茶碗在草寮前笑迎';
  }
  if (target?.ref?.role === 'outskirt_farmer') {
    return isSnowAct ? '正拍落斗笠薄雪，检看冬闲覆雪的外垄田埂' : (isWinAct ? '正倚着独轮木车察看霜封冬垄' : '正扶着长柄铁口锄整理外垄');
  }
  if (target?.ref?.role === 'outskirt_gatherer') {
    return isSnowAct ? '正护着竹晒架拂去枝头瑞雪' : (isWinAct ? '正细看冬眠桑枝，盼来年春芽肥嫩' : '正挽着采桑竹筐轻拂霜叶');
  }
  if (ctx.snow > 0.25 || ctx.weatherId === 'snow') return '正撑起油纸竹伞抖落肩头飞雪';
  if (mode === 'work' || target?.ref?.role === 'worker' || target?.ref?.role === 'hut_farmer') return '扶着木锄直起腰背';
  if (mode === 'sit' || target?.ref?.role === 'liubo_player') return '抬眼让出半边石凳';
  if (target?.ref?.role?.startsWith('child')) return '仰起脸打量你的斗笠';
  return '停步微笑着向你颔首';
}

const ROLE_WILDS_EGG_PREFS = {
  tea_roaster: ['wilds-bamboo-wind-chimes', 'wilds-crane-nest', 'wilds-ancient-kiln-cache'],
  lanke_elder: ['wilds-crane-nest', 'wilds-ancient-kiln-cache', 'wilds-bamboo-wind-chimes'],
  kiln_potter: ['wilds-ancient-kiln-cache', 'wilds-stone-sundial', 'wilds-crane-nest'],
  mountain_tea_host: ['wilds-stone-sundial', 'wilds-ancient-kiln-cache', 'wilds-jade-echo-spring'],
  tea_picker: ['wilds-stone-sundial', 'wilds-jade-echo-spring', 'wilds-ancient-kiln-cache'],
  spring_scholar: ['wilds-jade-echo-spring', 'wilds-stone-sundial', 'wilds-hermit-wine-cellar'],
  woodcutter: ['wilds-hermit-wine-cellar', 'wilds-firefly-lantern-shrine', 'wilds-jade-echo-spring'],
  mountain_hermit: ['wilds-firefly-lantern-shrine', 'wilds-hermit-wine-cellar', 'wilds-bamboo-wind-chimes'],
  altar_keeper: ['wilds-firefly-lantern-shrine', 'wilds-hermit-wine-cellar', 'wilds-stone-sundial']
};

const WILDS_EGG_RUMOR_SPEECH = {
  'wilds-crane-nest': '东岭悬松之巅常有双白鹤筑巢栖云，风顺时远远能听见几声清唳；沿着烂柯石枰东侧坡脊寻去，说不定能瞧见它们展翅落羽！',
  'wilds-stone-sundial': '北坡山脊草深处卧着一块先民立下的古石日晷，以铜针测时辰影移——顺着松风茶寮往东北高处找去，晴昼下最容易辨出石盘轮廓。',
  'wilds-jade-echo-spring': '三叠泉北侧的碧水深潭藏着一处回音翠壁，往潭边轻击青石便有清响三叠回荡，从冷泉幽轩沿涧边绕行不远就能听见水声。',
  'wilds-hermit-wine-cellar': '西岭云樵茅舍北面松坡下，早年山翁埋了几坛红泥封口的陈年松花醪，秋风一吹常有幽香透出木棚，走近便闻得见！',
  'wilds-firefly-lantern-shrine': '鹿柴望川台往西竹松掩映的苔崖下，藏着一座青苔小石龛，日暮以后总聚着一团青绿流萤，宛若山中自己点起的灯火。',
  'wilds-ancient-kiln-cache': '秦汉古窑南坡的旧窑灰里还存着一只先辈留下的青瓷秘匣，雨后林间常泛着一点淡青微光，从窑场顺坡走几十步就能寻着。',
  'wilds-bamboo-wind-chimes': '东涧碧涧茶坞以南的竹径旁，村人曾用长短青竹管搭过一架山风铃廊，山风穿竹便叮咚成律，行近便有清脆竹声相迎！'
};

function buildWildsRumorBranch(role, wildsEggState) {
  const sites = Array.isArray(wildsEggState?.sites) && wildsEggState.sites.length
    ? wildsEggState.sites
    : (wildsEggsCfg.sites || []);
  const discoveredSet = new Set(wildsEggState?.discovered || []);
  const remaining = sites.filter((s) => s && !discoveredSet.has(s.id));

  if (remaining.length === 0) {
    return {
      line: '哈哈，四山这七处山野奇踪倒都被客人一一寻遍了！听说连《桃源游记》里也盖上了「山野秘藏」朱印，今日有空不妨在岭上展开丹青留几幅山野墨卷！',
      replies: [
        { label: '叹山野七奇各具清趣，不虚此行', topic: 'delight' },
        { label: '拱手辞谢，再赴岭上写生', topic: 'thanks' }
      ],
      closings: {
        delight: '山川灵秀原待有心人，客人既有这份雅兴，四时阴晴再来也总有新意！',
        thanks: '慢走好走，山风清朗，祝客人再得佳作！'
      }
    };
  }

  const prefs = ROLE_WILDS_EGG_PREFS[role] || [];
  let chosen = null;
  for (let i = 0; i < prefs.length; i++) {
    const match = remaining.find((s) => s.id === prefs[i]);
    if (match) {
      chosen = match;
      break;
    }
  }
  if (!chosen) chosen = remaining[0];

  const countHint = remaining.length === sites.length
    ? '山野间共有七处隐秘奇踪尚未留名'
    : `算起来山野间还余${remaining.length}处奇踪未曾探访`;
  const speech = WILDS_EGG_RUMOR_SPEECH[chosen.id] || chosen.rumor || '';
  return {
    line: `${speech}（${countHint}——展卷按 [M] 点「寻」字，或行近细听山声，皆可觅其踪迹。）`,
    replies: [
      { label: '记下这则山野传闻，即刻前去寻访', topic: 'seek' },
      { label: '问此外其余山野秘踪如何辨认', topic: 'tips' }
    ],
    closings: {
      seek: '好嘞！行到近处留神听风声、泉声或鹤唳，也可看右上角小舆图边沿隐约浮出的小圈印记。',
      tips: '白昼观松鹤日晷与青瓷竹铃，暮夜探流萤古龛别有一番滋味；若一时迷向，展卷 [M] 点右下「寻」字便能照见余踪！'
    }
  };
}

function buildConversationScript(target, persona, mem, ctx, wildsEggState = null) {
  const role = persona.role;
  const fallbackLines = Array.isArray(target?.lines) && target.lines.length
    ? target.lines
    : ['客人一路辛苦，先在村里缓步走走，看看这田池桑竹罢。'];
  const isRepeat = mem.visits > 0;
  const isSnowing = (ctx.snow || 0) > 0.25 || ctx.weatherId === 'snow';
  const isRaining = ctx.rain > 0.28 || ctx.weatherId === 'rain';
  const isMist = ctx.weatherId === 'mist';
  const isNight = ctx.timeId === 'night';
  const isDawn = ctx.timeId === 'dawn';
  const isDusk = ctx.timeId === 'dusk';

  let envLine = '';
  if (isSnowing) {
    envLine = role.startsWith('child')
      ? '哇，鹅毛大雪落下来啦！屋顶和田埂全都白花花的，快踩踩看咯吱咯吱响呢！'
      : '朔雪纷飞，老辈常道“冬雪厚一尺、来年粟满仓”——客人衣肩落满雪花，快往茅檐下暖一暖手罢！';
  } else if (isRaining) {
    envLine = role.startsWith('child')
      ? '呀，落雨点了！大人方才催我们把院里的竹匾往屋檐底端呢，你也快避一避雨罢。'
      : '山里说风就是雨，晾竿上的麻布和竹匾刚赶着收进廊下，客人衣裳没打湿罢？';
  } else if (isNight) {
    envLine = role.startsWith('child')
      ? '天黑了阿娘不准我跑远，只有晒场篝火那边还亮着，池塘边萤火虫可多呢。'
      : `已到${ctx.shichen}时分，各家早灭了织机归灶歇息；若往晒场走走，兴许还有人拍缶唱山谣。`;
  } else if (isDawn) {
    envLine = `这会儿才刚${ctx.shichen}，溪上雾气未散，雄鸡一叫，田里塘边才渐渐有人影。`;
  } else if (isDusk) {
    envLine = `日脚偏西了，家家土烟囱都飘出淡蓝炊烟，老牛也牵回社树下反刍。`;
  } else if (isMist) {
    envLine = '山岚顺着后山竹林漫下来，远山只剩几道淡墨影子，走路留心石阶滑脚。';
  } else if (ctx.solarLore?.greet) {
    envLine = ctx.solarLore.greet;
  } else if (ctx.phenologyId === 'winter') {
    envLine = '山中落了薄雪，田畴歇犁、老牛入栏，家家火塘煨着热芋与温酒哩。';
  } else if (ctx.phenologyId === 'autumn') {
    envLine = '秋风一吹，平畴金粟低垂，后坡乌桕和枫树都染透了霜色。';
  } else if (ctx.phenologyId === 'summer') {
    envLine = '盛夏蝉声满树，池塘红荷正艳，往竹荫水亭下走最是凉爽。';
  }

  // Build role-tailored multi-turn script
  if (role === 'feast_host' || role === 'feast_elder' || role === 'feast_guest') {
    const t0 = isRepeat
      ? `贵客又回来坐坐？${envLine || '灶上还有温着的粟米醪酒，尽管取耳杯添满！'}`
      : fallbackLines[0];
    return {
      turn0: {
        topic: 'feast-welcome',
        line: t0,
        replies: [
          { label: '问山中先世避乱之事', topic: 'ancestors' },
          { label: '赞这鸡黍饮食与谷中风物', topic: 'customs' }
        ]
      },
      branches: {
        ancestors: {
          line: '先世当年避秦末乱兵，携老扶幼自黑石长缝寻得此处绝境，自此闭居耕读。听你方才说起外头朝代屡改，竟不知有汉，无论魏晋！',
          replies: [
            { label: '道外间赋役不息，难得此处清平', topic: 'peace' },
            { label: '问谷中人平日可常忆山外', topic: 'memory' }
          ],
          closings: {
            peace: '可不是么！只求年年风调雨顺、老少相安，外间争逐随它去——只是谷中之事，客人莫要向外间多宣扬才好。',
            memory: '最初两代或许还望过山头飞鸟，久了便只认得这四围桃花、几亩水田与檐下燕巢啰。'
          }
        },
        customs: {
          line: '粗陶釜炖的走地肥鸡配后山新笋，再温一壶村酿。谷里没有豪强官吏，邻里谁家有了贵客，大伙轮流延请设食，原是祖宗留下的老礼。',
          replies: [
            { label: '请教竹亭六博与击缶之乐', topic: 'leisure' },
            { label: '致谢主人盛意相待', topic: 'thanks' }
          ],
          closings: {
            leisure: `${leadSolarText(ctx.solarTerm, ctx.solarLore.closing)} 白日各忙桑麻稻粱，闲时便在竹亭摆青石盘行六博，晴夜在晒场击缶而歌，全不图虚名。`,
            thanks: '客气什么！你既穿得过那三十步幽狭石口来到这里，便是山川送来的稀客，快再多住两日。'
          }
        }
      }
    };
  }

  if (role === 'weaver' || role === 'carpenter' || role === 'bamboo_artisan') {
    const t0 = isRepeat
      ? `咦，又逛回这儿了？${envLine || `趁${ctx.shichen}天色好，我再把这手头活计赶完一段。`}`
      : (envLine ? `${envLine} ${fallbackLines[0]}` : fallbackLines[0]);
    const craftAsk = role === 'weaver'
      ? '问葛麻纺织与蓝靛染布诀窍'
      : role === 'carpenter'
        ? '赞这不用铁钉的先秦卯榫手艺'
        : '问竹篾编器与后山采笋门道';
    const craftAns = role === 'weaver'
      ? '斜织机全靠双脚踩踏板、手掷木梭；刚出染缸的麻布垂在老毛竹竿上滴水，正下面垫只豁口旧陶盆接着，染泥都不浪费哩。'
      : role === 'carpenter'
        ? '你看这食案和支摘窗框，全是先祖传下的燕尾榫与楔子咬紧，越用木头越实诚；刨下的松木卷花拾回去还能引火添香。'
        : '挑背阴坡三年生老毛竹，破开浸溪水三天再劈细篾，编出鱼篓、斗笠与连筒引水的竹枧，用上十年都不脆裂！';
    return {
      turn0: {
        topic: 'craft',
        line: t0,
        replies: [
          { label: craftAsk, topic: 'craftDetail' },
          { label: '打听村里器具和生活去处', topic: 'villageLife' }
        ]
      },
      branches: {
        craftDetail: {
          line: craftAns,
          replies: [
            { label: '问骤雨起时可来得及抢收', topic: 'weatherPrep' },
            { label: '点头称赞古法造物之巧', topic: 'praise' }
          ],
          closings: {
            weatherPrep: '早就习惯了！云脚一沉、风声变紧，院里大伙齐手收匾端盆，比看更漏还准哩。',
            praise: '不过顺着木性竹性做些应手家什，客人喜欢，往屋檐下坐会儿歇气便是。'
          }
        },
        villageLife: {
          line: fallbackLines[1] || '东边坡上有烧灰陶红陶的土窑，池畔青石板常有人捣衣，后山竹林深处雨后还冒春笋，你拿上工具也能走一遭。',
          replies: [
            { label: '记下去土窑、溪岸与竹林看看', topic: 'explore' },
            { label: '问村中还有何有趣之处', topic: 'more' }
          ],
          closings: {
            explore: '慢步细看罢，黄发老人和玩陀螺的童子最爱给人指路呢。',
            more: '古樟树底下有人下六博、养蜂蜜，沿溪水响着吱呀声的筒车一转就是整日，可清净啦。'
          }
        }
      }
    };
  }

  if (role === 'plowman') {
    const plowOpen = isRaining
      ? '雨点打湿田泥黏铧，我刚抬犁引青牯退到田头歇气——你看它曲膝卧得多安稳，客人也去前头瓜庐檐下躲躲雨罢！'
      : (isNight || isDusk)
        ? '日色沉下来啰，今日八趟深沟已翻得匀匀整整；卸松挽索任这头青牯卧在田头慢慢反刍，牲口出力最忌贪晚。'
        : isDawn
          ? '趁卯时露水未干、熟土酥润，套上曲木轭走头一趟最省牛力；听这生铁铧破土沙沙作响，心里头就踏实！'
          : (fallbackLines[0] || '客人行田埂留神脚下新泥！这头青牯性子温厚，负着曲木轭不消催逼，一步一沟走得笔管条直。');
    const t0 = isRepeat
      ? `又踱到田头来看牛耕啦！${isRaining || isNight || isDusk ? plowOpen : '你听这犁铧翻开湿泥沙沙的声响，再走两趟便让青牯歇晌饮水。'}`
      : plowOpen;
    return {
      turn0: {
        topic: 'ox-plowing',
        line: t0,
        replies: [
          { label: '问曲辕铁铧与扶犁深浅门道', topic: 'plowCraft' },
          { label: '赞青牯勤健，问村中惜牛之俗', topic: 'oxCare' }
        ]
      },
      branches: {
        plowCraft: {
          line: '这曲木犁辕拿老桑木烤弯定性，前头犁盘分挂双麻挽索贴着牛肋外走，绝不磨伤牛皮；底下生铁铧破土、弧面铁犁壁顺势把湿泥翻向一侧，手按横桄“压梢则浅、抬梢则深”，全凭腕底一股巧劲。',
          replies: [
            { label: '赞新翻犁沟笔直匀整、泥香扑鼻', topic: 'furrowPraise' },
            { label: '问这丘旱田翻好后种何庄稼', topic: 'cropPlan' }
          ],
          closings: {
            furrowPraise: '哈哈，沟直则苗匀，往后薅草培土都不伤根；客人若爱听这犁土沙沙声，站田埂上慢慢看便是！',
            cropPlan: `${leadSolarText(ctx.solarTerm, ctx.solarLore.closing)} 这丘高燥熟地晒过两日阳气、耙碎土块点种金粟，入秋便是一大片沉甸甸的垂穗粟田。`
          }
        },
        oxCare: {
          line: '谷里几户人家合养耕牛、换工伴耕：木轭底下必垫软麻，犁完半晌就牵去瓜庐阴凉或浅塘泥水里歇汗躲虻；它偶或昂首低哞一声，咱们听声便知它是口渴还是乏了。',
          replies: [
            { label: '感叹人牛相知、耕作从容不迫', topic: 'harmony' },
            { label: '拱手道声辛苦，不耽误扶犁赶趟', topic: 'leave' }
          ],
          closings: {
            harmony: '庄稼人靠牛吃饭，待它如自家兄弟一般，它下蹄自然肯往实里使劲哩。',
            leave: '好说好说！田头草埂软和，客人顺着阡陌往西还能去瓜庐舀瓢凉泉水喝。'
          }
        }
      }
    };
  }

  if (role === 'well_drawer' || role === 'herder') {
    const wellOpen = isRaining
      ? '刚把井台木桶收进檐下，正好同邻人避雨歇口气。客人衣襟潮了罢？来廊下站站！'
      : isDawn
        ? '趁卯时头一桶井水最清甜，提回去淘粟煮糜；方才正同放牛的三哥道早安哩。'
        : isDusk
          ? (role === 'herder'
              ? '日头落山坡了，塘里这头老水牛泡够了泥，东垄扶犁那头青牯也卸轭卧刍啰，我拿青竹梢慢慢护它归栏。'
              : '暮色拢上来了，再提半桶井水回灶房洗净陶釜，田头耕牛也歇下反刍，各家灯火快点起来啦。')
          : (role === 'herder'
              ? '咱们村两头壮水牛轮班出力：东垄那头青牯正负轭拉曲木犁翻旱田，塘里这头便浸在泥水里歇力躲虻，背上还常立着白鹭呢。'
              : '咱们村中这口青石古井通着深山暗脉，冬暖夏凉，大伙清晨汲水总要聊聊哪丘田今日套牛开犁。');
    const t0 = isRepeat
      ? `又行到这儿啦！${envLine || wellOpen}`
      : wellOpen;
    return {
      turn0: {
        topic: 'neighbor-life',
        line: t0,
        replies: [
          { label: role === 'herder' ? '问老水牛朝出暮归的习性' : '问古井泉脉与清晨邻里家常', topic: 'routine' },
          { label: '聊晴雨晨昏里村人的作息', topic: 'rhythm' }
        ]
      },
      branches: {
        routine: {
          line: role === 'herder'
            ? '春耕翻罢水田，白日任它卧在池塘浅滩歇力；一到酉时炊烟起，不用绳牵，拿细竹枝轻拍两下草叶，它自己就慢悠悠踏上干岸往草棚走啰。'
            : '每日鸡鸣头遍，东邻西舍提着木桶来汲新泉，你揖我让从不争抢；若是半途落雨，大伙便凑在最近一户深檐下听雨闲话，倒比晴天还热闹。',
          replies: [
            { label: '赞村中邻里相敬、禽畜自得', topic: 'harmony' },
            { label: '打听溪畔竹筌与茅亭棋局', topic: 'props' }
          ],
          closings: {
            harmony: '祖辈定居谷中只图个和睦清净，人待牲畜厚道，田亩自然也不亏负人。',
            props: '茅草亭青石盘上搁着六博竹箸，溪湾浅水还浸着竹编鱼筌，客人路过尽管上手试一试！'
          }
        },
        rhythm: {
          line: `${leadSolarText(ctx.solarTerm, ctx.solarLore.farming)} 咱们山里不设更鼓：晨雾散时汲水耕桑，骤雨来时收匾入檐，暮色合时牛归鸟宿——四时晨昏各有各的自在。`,
          replies: [
            { label: '点头感叹此间岁月从容', topic: 'calm' },
            { label: '拱手道谢，继续缓步游赏', topic: 'leave' }
          ],
          closings: {
            calm: '可不是么，日子慢些，连桃花落在溪水里的声响都听得真切。',
            leave: '慢走好走，井台青石湿润，留神脚下莫滑着哈！'
          }
        }
      }
    };
  }

  if (role === 'washer' || role === 'trapper' || role === 'basket' || role === 'worker' || role === 'hut_farmer' || role === 'beekeeper') {
    const t0 = isRepeat
      ? `又逢着你啦！${mem.lastTopic === 'waterwork' ? '方才说起的水车与鱼笼，这会儿去看了吗？' : (envLine || fallbackLines[1] || fallbackLines[0])}`
      : (envLine ? `${envLine} ${fallbackLines[0]}` : fallbackLines[0]);
    return {
      turn0: {
        topic: 'rural-work',
        line: t0,
        replies: [
          { label: '问农田池塘与溪水引灌之事', topic: 'waterwork' },
          { label: '聊聊村里禽畜生灵与日常节律', topic: 'creatures' },
          { label: '问田里扶犁耕牛之事', topic: 'plowing' }
        ]
      },
      branches: {
        waterwork: {
          line: '你看山坡那边架着的毛竹连筒，把冷冽山泉直接引到院角大水缸和池塘；急水滩头那架竹筒车昼夜转个不停，不用人力便能浇遍高田。',
          replies: [
            { label: '问鱼篓虾笼何时收成最好', topic: 'catch' },
            { label: '向村民借个歇脚茶水方位', topic: 'restSpot' }
          ],
          closings: {
            catch: '寅卯之交起水最好！清晨去提菖蒲根底的竹筌，鲫鱼河虾混着水花乱蹦，晌午正好下陶鬲煮汤。',
            restSpot: '田埂路口那个四面透风的茅草瓜庐里铺着竹席，搁着凉水陶壶，农人都上那儿歇汗，你自管去！'
          }
        },
        creatures: {
          line: '那头老水牛晌午最爱泡池塘泥水躲日头，白鹭常落在它脊背上啄牛虻；大黄狗看似懒洋洋趴门槛，混熟了保准摇尾巴跟去林边！',
          replies: [
            { label: '笑问清晨公鸡与屋檐燕窝', topic: 'morning' },
            { label: '顺道告别继续往村深处游览', topic: 'farewell' }
          ],
          closings: {
            morning: '天刚放白公鸡一扯嗓子，芦花母鸡就带一串鸡仔出来刨食；夏夜池边蛙叫流萤飞，热闹得很呢！',
            farewell: '踩稳青石与田埂路，莫惊散了草堆旁啄虫的小鸡仔哈。'
          }
        },
        plowing: {
          line: '客人也瞧见田里那头壮牛了罢？它负着木轭引曲木犁，扶犁的汉子短褐扎腿，双手按定犁梢随牛缓步；铁铧过处，新泥翻作一道道笔直深沟，晌午歇力便牵去瓜庐下阴凉里反刍。',
          replies: [
            { label: '赞牛力勤健、农人扶犁之巧', topic: 'praise' },
            { label: '问犁沟翻土为何须得笔直', topic: 'furrow' }
          ],
          closings: {
            praise: '牛通人性，晓得轻重；人惜牛力，不肯催逼。一犁一沟慢慢翻，田土松透了，粟苗才扎根得深哩。',
            furrow: '沟直则行距匀，通风透光，薅草也顺手；老把式扶犁梢稳得很，铧尖吃土深浅一致，翻出来的沟才笔管条直。'
          }
        }
      }
    };
  }

  if (role.startsWith('child')) {
    const t0 = isRepeat
      ? (isNight ? '阿娘刚喊我回屋去哩，外客明儿天亮再来跟我们比斗草和打水漂罢！' : '大哥哥你回来啦！你看我刚拾到一片花纹可好看的鹅卵石！')
      : (envLine || fallbackLines[0]);
    return {
      turn0: {
        topic: 'childplay',
        line: t0,
        replies: [
          { label: '问山缝外面与村里好玩去处', topic: 'play' },
          { label: '夸他眼尖手巧，再聊聊村中长辈', topic: 'elders' }
        ]
      },
      branches: {
        play: {
          line: fallbackLines[1] || '我可知道哪儿好玩：先看老木匠刨出卷卷的香木花，再去社树底下抽木陀螺，傍晚去水边看桃花瓣打转！',
          replies: [
            { label: '答应待会儿过去瞧一瞧', topic: 'agree' },
            { label: '问山谷里头哪里藏着古怪物件', topic: 'secret' }
          ],
          closings: {
            agree: '那说定啰！别踩扁田埂边的车前草，留几根耐扯的明日跟我比斗草！',
            secret: '听说老樟树后坡和古井石头那儿，以前老人们藏过竹简木匣呢，我个头矮还够不着。'
          }
        },
        elders: {
          line: '社树下的老阿翁活过好多轮春社秋社了，一肚子古时候躲避秦兵的故事；织布的阿婶还会做甜甜的桑葚米糕哩！',
          replies: [
            { label: '笑问他平时最怕家里什么差事', topic: 'chore' },
            { label: '嘱咐他别跑太近深塘水边', topic: 'care' }
          ],
          closings: {
            chore: '最怕突然起风下雨，得一路跑着端竹匾收干笋，少收一片都要挨阿爷念叨！',
            care: '晓得啦！水浅着呢，我有竹竿探深浅才不敢滑下青石！'
          }
        }
      }
    };
  }

  if (role === 'herbalist' || role === 'terrace_farmer') {
    const t0 = isRepeat
      ? `又行到北山坞来啦！${envLine || fallbackLines[1] || fallbackLines[0]}`
      : (envLine ? `${envLine} ${fallbackLines[0]}` : fallbackLines[0]);
    const isHerb = role === 'herbalist';
    return {
      turn0: {
        topic: 'borderland',
        line: t0,
        replies: [
          { label: isHerb ? '请教云雾野茶与百草药畦门道' : '问三叠飞泉与曲水梯田引灌之法', topic: 'skill' },
          { label: '打听东皋高亭与北山幽景去处', topic: 'scenery' }
        ]
      },
      branches: {
        skill: {
          line: isHerb
            ? '山阴多云雾，茶树顺着坡势成垄，芽叶肥厚回甘；屋旁四方青石畦里分种紫苏、甘菊、桔梗与菖蒲，引竹枧活水浇灌，满院都是清气。'
            : '北崖那道三叠飞泉终年不绝，先人垒石成潭、凿渠架桥，让泉水自最高一级梯田漫入下一级，不费桔槔便能润透半坡新秧。',
          replies: [
            { label: isHerb ? '赞这竹炉烹泉、草木养人之雅' : '赞先民顺应山川水势之巧', topic: 'praise' },
            { label: '问雨夜晴昼山坞各有何景致', topic: 'mood' }
          ],
          closings: {
            praise: isHerb
              ? '山居清简，无非一炉松火、半瓯春茗；客人若渴了，自管去竹炉旁揭铫试茶。'
              : '靠山吃山、惜水如金，田埂下白鹭天天来踱步捉小鱼，人鸟相安哩。',
            mood: isHerb
              ? '晴昼药畦上粉蝶成群，一入暮夜，北涧石渠与草堂外便浮起流萤点点，清幽得很。'
              : '晴日水田如镜映着双鹤盘旋，落雨时飞泉声传二里地，坐在这望稼楼檐下听泉最好不过！'
          }
        },
        scenery: {
          line: '顺着北麓土路往东过青石桥，穿过梨园便上东皋晴坡——坡腰晒着五色秋实，白羊散在芳草间，再往上便是六角观云亭与先祖留下的记事残碑。',
          replies: [
            { label: '记下路径，去观云亭与残碑一观', topic: 'goEast' },
            { label: '拱手致谢长者指点', topic: 'thanks' }
          ],
          closings: {
            goEast: '石阶平缓好走，亭下石凳正好西望全谷烟霞，莫错过那株迎客苍松！',
            thanks: '慢步细赏罢，山风微凉，走累了随时回来歇脚饮茶。'
          }
        }
      }
    };
  }

  if (role === 'mountain_tea_host' || role === 'tea_picker' || role === 'woodcutter' || role === 'lanke_elder' || role === 'kiln_potter' || role === 'mountain_hermit' || role === 'altar_keeper' || role === 'spring_scholar' || role === 'tea_roaster') {
    const t0 = isRepeat
      ? `又登岭来寻清静啦！${envLine || fallbackLines[1] || fallbackLines[0]}`
      : (envLine ? `${envLine} ${fallbackLines[0]}` : fallbackLines[0]);
    const topicLabelA = role === 'mountain_tea_host' || role === 'tea_picker'
      ? '请教松风煎茶与山坡云雾茶垄'
      : role === 'lanke_elder'
        ? '静观石枰残局，问山中弈棋岁月'
        : role === 'kiln_potter'
          ? '问山阿龙窑烧制灰陶耳杯之法'
          : role === 'altar_keeper'
            ? '问古社避秦誓约与春祈秋报礼俗'
            : role === 'spring_scholar'
              ? '问轩中竹简旧录与竹笕冷泉之清幽'
              : role === 'tea_roaster'
                ? '问碧涧源头采青炒茶的火候讲究'
                : '问山径采樵与高岭望云之乐';
    const branchLineA = role === 'mountain_tea_host' || role === 'tea_picker'
      ? '北岭高敞向阳、朝暮多雾，最宜养这几垄野茶；拾松果枯枝慢煨泥炉，引岩上活泉三沸，茶汤清亮回甘，喝一碗浑身松快！'
      : role === 'lanke_elder'
        ? '老友携一笥黑白石子登山，松阴移过半块青石才落十余手；偶闻崖下鸡鸣犬吠，恍然不知今夕何年——客人若兴起，坐石凳上按数字键亦能扣石和音哩。'
        : role === 'kiln_potter'
          ? '借山坡天然仰势筑这五级龙窑，火借风势节节上蹿；取溪湾澄泥拉坯，烧出的素面灰陶釜与漆耳杯敦厚耐用，合村老少都使它。'
          : role === 'altar_keeper'
            ? '先世初入山谷便立此青石社坛、手植古樟为记；每年春分祭社祈秧、秋分报社谢谷，不拜王侯将相，唯敬天地与山川邻里！'
            : role === 'spring_scholar'
              ? '这几捆韦编竹简录着全谷开荒凿渠、移栽桃李桑麻的年谱；引北山活泉落入青石池，昼听水声、夜伴灯影，读到会心处真是忘忧。'
              : role === 'tea_roaster'
                ? '东涧源头昼有山雾、夜有清露，老茶芽叶格外肥厚；灶下只烧干松柴微火摊炒，焙出竹匾里这种带兰香的春茶，喝一口浑身清爽！'
                : '咱们入山只拾风折松枝与枯木，从不伤新发幼树；挑柴行在半岭云气里，低头是千亩桃林桑竹，抬头是自在飞鸟。';
    return {
      turn0: {
        topic: 'mountain-life',
        line: t0,
        replies: [
          { label: topicLabelA, topic: 'craft' },
          { label: '打听四山幽境还有何可游之处', topic: 'peaks' },
          { label: '打听近来山野间可有奇闻异景', topic: 'rumor' }
        ]
      },
      branches: {
        craft: {
          line: branchLineA,
          replies: [
            { label: '赞山上人家与草木烟霞相伴之雅', topic: 'praise' },
            { label: '问雨雪晴夜岭上光景如何', topic: 'weather' }
          ],
          closings: {
            praise: '山不在高，有人烟茶火便不寂寥；客人走乏了，只管在茶寮竹凳或松下石墩歇脚！',
            weather: '落雨时茅檐下听松涛煮热茗，冬日看薄雪覆满茶垄与苍松，四时都有看不够的画意。'
          }
        },
        peaks: {
          line: '北岭有松风茶寮、三叠泉与山顶冷泉幽轩，东岭崖松下设着烂柯石枰，再往东过独木山桥便是碧涧茶坞；西岭既有鹿柴望川台与云樵茅舍，西南尽头更有古社避秦坛，全谷山径四通八达！',
          replies: [
            { label: '循着山径逐一探访诸处幽景', topic: 'go' },
            { label: '拱手致谢山中长者指点', topic: 'thanks' }
          ],
          closings: {
            go: '山路蜿蜒平缓，沿途遇到梅花鹿和山羊，慢步上前还能轻抚饲草呢！',
            thanks: '好说好说，岭上风清，客人慢行莫急。'
          }
        },
        rumor: buildWildsRumorBranch(role, wildsEggState)
      }
    };
  }

  if (role === 'wuling_fisherman' || role === 'wuling_woodcutter' || role === 'wuling_herbalist') {
    const isWinterWuling = isSnowing || ctx.phenologyId === 'winter';
    const isWinterNight = isWinterWuling && (isNight || isDusk);
    const isWinterThawDay = isWinterWuling && !isSnowing && !isRaining && !isNight && !isDusk && !isDawn;
    const winterGreeting = role === 'wuling_fisherman'
      ? (isSnowing && (isNight || isDusk)
        ? '朔雪纷飞入寒夜，正是武陵渡最幽静的「寒江渔火」光景！筏头与亭檐两盏暖灯映着岸畔薄冰，茅檐挂满淡青冰凌，客官快到灯下歇脚驱寒！'
        : isSnowing
          ? '朔雪纷飞，好一场寒江瑞雪！雪落溪面悄无声息，溪岸浅滩已凝起断续薄冰，只听竹筏偶磕杉木桩，渡亭檐下倒挂起一排淡青小冰凌——客官快到檐下暖灯旁避避风雪！'
          : isWinterNight
            ? '冬夜寒星低垂，渡亭与孤筏两盏渔火在薄冰溪湾里晃成碎金——这便是老汉最爱守着的「寒江渔火」！浅滩结着素净冰缘，客官不妨按 [O] 留一幅墨卷再往洞口行！'
            : isWinterThawDay
              ? '雪霁初晴，日头一照，亭檐那排淡青冰凌叮咚滴水，浅滩岸冰也映出青绿天光！这会儿不冷不寒，竹筏随波微晃，正是武陵溪难得的冬日暖昼。'
              : '冬晨薄霜未散，溪畔浅滩凝着一圈素净薄冰，我一早点亮筏头风灯、检好缆绳；远山云岚映着薄雪，倒比春日更像一幅水墨长卷。')
      : role === 'wuling_woodcutter'
        ? (isSnowing
          ? '踏雪行在桃林小径咯吱作响，反倒走得一身暖意！这两捆风折干松柴带回灶堂最耐烧，客官鞋履沾雪，歇脚石台旁留神滑脚。'
          : '山里冬寒来得早，苍松落枝晒得焦干，挑一担回去煨火塘正好驱寒；你看云气顺着危峰山腰慢慢流，真个幽深！')
        : (isSnowing
          ? '别看漫山飞雪，苔石缝里那几簇野山茶反倒傲雪绽出胭脂红来！浅滩白鹭缩颈静栖，客官轻步慢行，正好细赏这雪谷生机。'
          : '冬令霜重，正是采挖溪畔老根入药的好时节；寒风一吹说话都带着白气，若走乏了不妨去前头渡口茅亭坐坐。');
    const t0 = isRepeat
      ? `客官又回溪岸歇脚啦！${isWinterWuling ? winterGreeting : (envLine || fallbackLines[1] || fallbackLines[0])}`
      : (isWinterWuling ? winterGreeting : (envLine ? `${envLine} ${fallbackLines[0]}` : fallbackLines[0]));
    const askA = role === 'wuling_fisherman'
      ? (isWinterNight
        ? '问这冬夜「寒江渔火」与岸边薄冰趣事'
        : isWinterThawDay
          ? '听这雪霁冰檐滴水与寒溪薄冰之景'
          : (isWinterWuling ? '聊这寒江飘雪与渡口渔火竹筏' : '问这武陵渡口竹筏与溪上捕鱼生计'))
      : role === 'wuling_woodcutter'
        ? (isWinterWuling ? '问雪径采松柴与冬日听溪之趣' : '问夹岸桃林与山樵歇脚来路')
        : (isWinterWuling ? '问傲雪山茶与冬日溪谷草木' : '问溪谷灵草与浅滩白鹭踪迹');
    const ansA = role === 'wuling_fisherman'
      ? (isWinterNight
        ? '夜寒时溪湾浅处凝起一圈青白薄冰，唯有中流活水不冻；竹筏轻磕老杉桩，亭檐与筏头两盏风灯把碎金暖光撒进水面，晚归打渔人隔着半里就能认得渡口！'
        : isWinterThawDay
          ? '别瞧清晨岸畔结了薄冰，待午时日头暖融，亭檐冰凌便一滴一滴化作清响，连浅滩白鹭也专拣岸冰空隙里啄鱼呢！'
          : (isWinterWuling
            ? '冬溪水寒鱼沉深潭，便少撒几网；但茅亭和筏头两盏油纸风灯逢雪必亮，微光映着水波余晕与岸边薄冰，好教误入溪湾的行舟认得渡口！'
            : '渡口水流平缓，缚七根三年老毛竹作筏最吃水稳当；清早撒两网溪鱼晒在茅亭竹架上，换些盐米浊酒便逍遥度日。'))
      : role === 'wuling_woodcutter'
        ? (isWinterWuling
          ? '雪后松脂更香，拾些风折老枝捆牢挑下坡，满路踏雪印过半晌便被新雪轻轻抚平，山林又复一片素净。'
          : '往常只在南山坡拾些风折干松枝，今日顺着溪香多走了几里，但见夹岸芳草如茵、落瓣满肩，连担子都不觉沉了。')
        : (isWinterWuling
          ? '山茶耐寒，越是素白寒雪里越显得娇艳；我挎篮只摘几片霜打老叶焙茶，留着红花给往来行客添一抹冬日亮色。'
          : '这溪谷背风润泽，青苔石缝多生石菖蒲与野山茶；浅水那几只白鹭终日涉水啄鱼，见人走过只管偏头细看，灵性得很。');
    const praiseClose = (role === 'wuling_fisherman' && isWinterWuling)
      ? '哈哈，寒江虽冷，有这盏暖灯、岸畔薄冰与一壶热浊酒相伴，客官按 [O] 挥毫留影便是一帧《寒江渔火》！'
      : '哈哈，山野粗茶淡饭，胜在耳畔只有水声鸟语，客官不妨多听半晌！';
    return {
      turn0: {
        topic: 'wuling-stream',
        line: t0,
        replies: [
          { label: askA, topic: 'livelihood' },
          { label: '打听林尽水源处那座危崖窄口', topic: 'upstream' }
        ]
      },
      branches: {
        livelihood: {
          line: ansA,
          replies: [
            { label: '赞这桃溪渔樵自在风光', topic: 'praise' },
            { label: '问茅亭石碣与沿途歇脚处', topic: 'rest' }
          ],
          closings: {
            praise: praiseClose,
            rest: '渡口茅亭与前湾松柴石台都干净平整，走乏了按 [X] 坐下静听溪流最是解乏。'
          }
        },
        upstream: {
          line: '顺着小径或摇扁舟再往北行，桃花越发繁密；到得林尽水源处，两壁危峰耸立如门，底下隐约有一线幽狭石口，仿佛透出微光——我还不曾深入探过，客官若有兴致，何不前往一探？',
          replies: [
            { label: '决意缘溪前行，入那石口一探究竟', topic: 'venture' },
            { label: '拱手道谢指路之情', topic: 'thanks' }
          ],
          closings: {
            venture: '石口初段幽狭背光，脚下留神湿苔，祝客官寻得一处好景致！',
            thanks: '客气啥，山水相逢便是有缘，慢走好走！'
          }
        }
      }
    };
  }

  if (role === 'outskirt_greeter' || role === 'outskirt_farmer' || role === 'outskirt_gatherer') {
    const isWinterOutskirt = isSnowing || ctx.phenologyId === 'winter';
    const isWinterNightOut = isWinterOutskirt && (isNight || isDusk);
    const isWinterThawOut = isWinterOutskirt && !isSnowing && !isRaining && !isNight && !isDusk && !isDawn;
    const winterOutGreeting = role === 'outskirt_greeter'
      ? (isSnowing && (isNight || isDusk)
        ? '雪夜出洞一路风寒，快趁热掬一碗陈桑姜茗！你看草寮暖灯映着檐下淡青冰凌，瓦瓮里热气直冒，正是村人常说的「雪村暖茗」，喝完浑身便舒坦了！'
        : isSnowing
          ? '贵客冒雪出洞辛苦啦！快趁热掬一碗施茶瓦瓮里的陈桑姜茗——你看瓮口热气直冒、檐下垂着淡青小冰凌，灯下喝完顿时浑身回暖！'
          : isWinterNightOut
            ? '冬夜寒深，老汉特意守着草寮暖灯与滚热陈桑姜茗候客！檐下冰凌映着灯晕，村里人家烟囱正飘晚炊，按 [E] 掬饮一碗「雪村暖茗」再入村罢！'
            : isWinterThawOut
              ? '雪霁初晴好日头！茅檐垂着的淡青冰凌正叮咚滴水，瓦瓮里陈桑姜茗仍温得恰到好处——客官饮一碗「雪村暖茗」，听这清脆檐滴声再往村里逛逛！'
              : '冬寒入谷，老汉特地在瓦瓮里添了老姜与霜桑叶，温着陈桑姜茗候客；檐下冰凌透着晨光，按 [E] 掬饮一碗，再去村里暖灶旁歇脚最妙！')
      : role === 'outskirt_farmer'
        ? (isSnowing
          ? '瑞雪兆丰年哪！大雪把外垄田埂捂得严严实实，冬歇修好独轮木车与铁口锄，来年开春墒情定然极好！'
          : '冬日田畴封霜歇犁，俺把禾草垛苫牢、车轴上好松脂油，闲来只看远山雪岚与村里袅袅炊烟。')
        : (isSnowing
          ? '下雪天正好给桑树覆层雪被杀虫！竹架和晒匾我都拾掇利索了，待春风一回暖，这西郊便又是满林新翠。'
          : '寒冬桑叶落尽、枝干舒朗，趁农闲修补高竹篓与圆竹匾，静候明年春蚕吐丝哩。');
    const t0 = isRepeat
      ? `贵客又行到村郊来啦！${isWinterOutskirt ? winterOutGreeting : (envLine || fallbackLines[1] || fallbackLines[0])}`
      : (isWinterOutskirt ? winterOutGreeting : (envLine ? `${envLine} ${fallbackLines[0]}` : fallbackLines[0]));
    const askA = role === 'outskirt_greeter'
      ? (isWinterThawOut
        ? '品一碗「雪村暖茗」，闲聊这雪霁冰檐滴水之趣'
        : (isWinterOutskirt ? '讨一碗热腾腾的冬日陈桑姜茗驱寒' : '讨一碗施茶草寮的温热山茗'))
      : role === 'outskirt_farmer'
        ? (isWinterOutskirt ? '问冬雪封田与独轮木车冬闲保养' : '问田头独轮木车与外垄耕种之事')
        : (isWinterOutskirt ? '问西郊桑林过冬与春蚕筹备' : '问西郊采桑与后山竹茶路径');
    const ansA = role === 'outskirt_greeter'
      ? (isWinterThawOut
        ? '请满饮这碗陈桑姜茗！雪晴日暖时茅檐玉箸慢慢化水，滴答落在青石上清脆悦耳，衬得瓦瓮热茶更香；客官若喜这景致，按 [O] 便能收进《雪村暖茗》一卷里！'
        : (isWinterOutskirt
          ? '快请满饮！冬日改用山泉慢煎陈霜桑叶配两片老姜，热气绕着檐下暖灯袅袅升起，喝下肚去，连踏雪走十里山路都不觉寒！'
          : '请饮请饮！这大瓦瓮里是清晨新汲的深山冷泉，泡着晒干的霜桑叶与甘菊，不苦不涩；路东那株迎客苍松，几百年来不知替多少耕归村人遮过日头与风雪。'))
      : role === 'outskirt_farmer'
        ? (isWinterOutskirt
          ? '俗话说“麦盖三层被，枕着馒头睡”——这雪落得厚实，田里虫卵冻尽、春雪化水最润土，俺们就安心在暖屋煨芋温酒啰！'
          : '这独轮木推车窄辙轻巧，沿着三尺田埂推草运谷全不压伤庄稼；谷口向阳暖和，每年春耕头一犁、秋收头一镰都打这儿开张！')
        : (isWinterOutskirt
          ? '桑树耐冬寒，雪停后太阳一照，檐角冰凌化水滴进根土，开春萌出的头茬桑芽嫩得掐得出水来！'
          : '西郊土厚水清，桑叶大如蒲扇；晒匾上摊匀晾干水气再去喂蚕，结出的春茧又白又紧实——顺着西边小桥再往上，还能去后山竹林与云岭茶寮转转哩。');
    const seasonClose = (role === 'outskirt_greeter' && isWinterOutskirt)
      ? '春日落英满径，夏听蝉鸣荷风，秋看金粟盈车，冬日雪覆茅檐、瓦瓮温着「雪村暖茗」，晴午更有冰檐滴水相和——四时皆可入画！'
      : `${leadSolarText(ctx.solarTerm, ctx.solarLore.closing)} 春日落英满径，夏听蝉鸣荷风，秋看金粟盈车，冬日瑞雪覆满苍松茅檐——四时皆可入画！`;
    return {
      turn0: {
        topic: 'village-outskirts',
        line: t0,
        replies: [
          { label: askA, topic: 'work' },
          { label: '问村中酒食款待与各处去向', topic: 'guide' }
        ]
      },
      branches: {
        work: {
          line: ansA,
          replies: [
            { label: '称赞谷口风物淳厚、井然有致', topic: 'praise' },
            { label: '问四时雨雪里村郊景致', topic: 'season' }
          ],
          closings: {
            praise: '不求富贵繁华，但得老少和乐、岁岁有余粮，这日子便比蜜还甜。',
            season: seasonClose
          }
        },
        guide: {
          line: '顺着面前大路往北几步便是设酒杀鸡的家宴院落，再往里有美池浣衣、社树六博与东垄牛耕；四围山岭还藏着茶寮、石枰与古窑，条条阡陌皆通！',
          replies: [
            { label: '道声多谢，缓步入村细细游历', topic: 'enter' },
            { label: '在草寮木榻旁稍歇片刻', topic: 'stay' }
          ],
          closings: {
            enter: '尽管自便，乡邻们见了远客欢喜还来不及，莫要拘束！',
            stay: '好嘞，檐下风软茶温，客人慢慢歇脚。'
          }
        }
      }
    };
  }

  // General elder / shrine_elder / liubo / singer / walker / talker / villager
  const t0 = isRepeat
    ? `又见客人漫步至此，${mem.lastTopic === 'world' ? '刚才聊起山外年景，老汉心中倒还思量着呢。' : (envLine || fallbackLines[1] || fallbackLines[0])}`
    : (envLine ? `${envLine} ${fallbackLines[0]}` : fallbackLines[0]);
  return {
    turn0: {
      topic: 'talk',
      line: t0,
      replies: [
        { label: `问「${ctx.solarTerm}」村中农事与时令`, topic: 'solarTerm' },
        { label: '说起山外武陵渔津与沿途所见', topic: 'world' }
      ]
    },
    branches: {
      solarTerm: {
        line: leadSolarText(ctx.solarTerm, ctx.solarLore.farming),
        replies: [
          { label: '打听何处可细听风物雅韵', topic: 'spots' },
          { label: '称羡此处顺应四时、黄发垂髫之乐', topic: 'joy' }
        ],
        closings: {
          spots: '顺溪木桥与竹亭旁风最凉，东边田垄能听见水牛低哞与铁犁翻泥的沙沙声；若入暮夜，立在亭下看炊烟低垂最是入画。',
          joy: ctx.solarLore.closing || fallbackLines[2] || '山中不知历法几经更替，唯愿春畴牛耕顺遂、田谷年年熟，犬吠鸡鸣常在耳畔。'
        }
      },
      world: {
        line: '你从林尽水源那条幽长石缝穿行数十步进来，一路倒没迷了方向罢？外间尘世听说赋重役繁，果真连片清净溪山也难寻？',
        replies: [
          { label: '坦言外间繁喧，此地真似世外', topic: 'peaceful' },
          { label: '询问谷中人可曾知晓外界朝代', topic: 'era' }
        ],
        closings: {
          peaceful: '既嫌外间繁杂，便多在谷中盘桓数日，喝几碗粗陶新醅再作打算！',
          era: '打从先祖遁入山后便不复出焉，什么朝代兴衰早隔断啰，只管耕自己的地、织自己的麻。'
        }
      }
    }
  };
}

export function createVillagerDialogue(deps = {}) {
  const { sky, getWorldClock, getPhenology, getWildsEasterEggs = null, doc } = deps;
  const memories = new Map();
  let session = null;
  let totalTurns = 0;
  let questBridge = deps.questBridge || null;

  function setQuestBridge(bridge) {
    questBridge = bridge || null;
  }

  function ensureMemory(target) {
    const key = String(target?.key || 'villager');
    if (!memories.has(key)) {
      memories.set(key, {
        identity: buildPersona(target),
        visits: 0,
        lastTopic: null,
        lastTalkMs: 0
      });
    }
    return memories.get(key);
  }

  function formatMeta(persona, mem, action, ctx) {
    const visitTag = mem.visits > 0 ? ` · 曾叙${mem.visits}次` : ` · ${persona.trait}`;
    return `${ctx.seasonWord} · ${ctx.solarTerm} · ${ctx.shichen} · ${ctx.weatherWord} · ${action}${visitTag}`;
  }

  function beginOrAdvance(target) {
    if (!target || (target.kind !== 'person' && target.kind !== 'community')) return null;
    if (session && session.key === target.key && session.hasMore) {
      return chooseReply(0);
    }

    const mem = ensureMemory(target);
    const ctx = safeClockText(getWorldClock, sky, getPhenology);
    const action = describeActivity(target, ctx);
    const wildsObj = typeof getWildsEasterEggs === 'function' ? getWildsEasterEggs() : (deps.wildsEasterEggs || null);
    const wildsSites = wildsObj?.getSites?.() || wildsEggsCfg.sites || [];
    const wildsDiscovered = wildsObj?.getStats?.()?.discovered || wildsSites.filter((s) => s.discovered).map((s) => s.id);
    const wildsEggState = { sites: wildsSites, discovered: wildsDiscovered };
    const script = buildConversationScript(target, mem.identity, mem, ctx, wildsEggState);
    mem.visits += 1;
    mem.lastTalkMs = Date.now();
    totalTurns += 1;

    questBridge?.onTalk?.(target, mem.identity, ctx);
    const questOffer = questBridge?.getDialogueOffer?.(target, mem.identity, ctx) || null;
    const baseReplies = Array.isArray(script.turn0.replies) ? script.turn0.replies.slice() : [];
    const branches = script.branches ? { ...script.branches } : {};
    if (questOffer && questOffer.replyLabel && questOffer.npcReply) {
      baseReplies.push({
        label: questOffer.replyLabel,
        topic: '__quest__',
        questKind: questOffer.kind || 'offer',
        questTitle: questOffer.questTitle || ''
      });
      branches.__quest__ = {
        line: questOffer.npcReply,
        replies: [{ label: questOffer.followUpLabel || '谨记在心，就此辞别', topic: 'ack' }],
        closings: { ack: questOffer.closingReply || '慢走慢逛，山中自有清风相迎。' }
      };
    }
    const activeScript = {
      ...script,
      turn0: { ...script.turn0, replies: baseReplies },
      branches
    };

    session = {
      key: target.key,
      target,
      who: mem.identity.who,
      meta: formatMeta(mem.identity, mem, action, ctx),
      action,
      line: activeScript.turn0.line,
      replies: activeScript.turn0.replies.map((r, i) => ({
        index: i,
        key: String(i + 1),
        label: r.label,
        topic: r.topic,
        questKind: r.questKind || null,
        questTitle: r.questTitle || ''
      })),
      hasMore: true,
      turn: 0,
      branchTopic: null,
      script: activeScript,
      mem,
      ctx,
      visits: mem.visits,
      questOffer
    };

    return {
      key: session.key,
      who: session.who,
      meta: session.meta,
      action: session.action,
      solarTerm: ctx.solarTerm,
      line: session.line,
      replies: session.replies,
      hasMore: session.hasMore,
      turn: session.turn,
      visits: session.visits
    };
  }

  function chooseReply(choiceIndex = 0) {
    if (!session || !session.hasMore) return null;
    const idx = Math.max(0, Math.min((session.replies?.length || 1) - 1, choiceIndex | 0));
    const chosen = session.replies[idx];
    if (!chosen) return null;

    totalTurns += 1;
    session.mem.lastTopic = chosen.topic;

    if (session.turn === 0) {
      const freshCtx = safeClockText(getWorldClock, sky, getPhenology);
      if (chosen.topic === '__quest__' && session.questOffer) {
        questBridge?.onDialogueSelect?.(session.questOffer, session.target, session.mem.identity, freshCtx);
      }
      const br = session.script.branches[chosen.topic];
      session.turn = 1;
      session.branchTopic = chosen.topic;
      session.line = br?.line || '原来如此，山里人听着也稀罕得很呢。';
      session.replies = (br?.replies || []).map((r, i) => ({ index: i, key: String(i + 1), label: r.label, topic: r.topic }));
      session.hasMore = session.replies.length > 0;
      session.meta = `${freshCtx.solarTerm} · ${freshCtx.shichen} · 你答「${chosen.label.slice(0, 12)}…」`;
    } else {
      const br = session.script.branches[session.branchTopic];
      const closing = br?.closings?.[chosen.topic] || '客人且慢慢逛着，村里处处的篱笆都是半掩着的。';
      session.turn = 2;
      session.line = closing;
      session.replies = [];
      session.hasMore = false;
      const freshCtx = safeClockText(getWorldClock, sky, getPhenology);
      session.meta = `${freshCtx.solarTerm} · ${freshCtx.shichen} · 话尽辞别`;
    }

    const res = {
      key: session.key,
      who: session.who,
      meta: session.meta,
      action: session.action,
      line: session.line,
      replies: session.replies,
      hasMore: session.hasMore,
      turn: session.turn,
      visits: session.visits,
      target: session.target,
      chosenLabel: chosen.label
    };

    if (!session.hasMore) {
      session = null;
    }
    return res;
  }

  function getPromptHint(target) {
    return questBridge?.getPromptHint?.(target) || null;
  }

  function isOpenFor(key) {
    return Boolean(session && session.key === key && session.hasMore);
  }

  function getActiveSession() {
    return session ? {
      key: session.key,
      who: session.who,
      turn: session.turn,
      hasMore: session.hasMore,
      replies: session.replies,
      target: session.target
    } : null;
  }

  function close() {
    session = null;
  }

  function reset() {
    session = null;
    memories.clear();
  }

  return {
    beginOrAdvance,
    chooseReply,
    setQuestBridge,
    getPromptHint,
    isOpenFor,
    getActiveSession,
    close,
    reset,
    getStats: () => ({
      rememberedVillagers: memories.size,
      totalTurns,
      activeKey: session ? session.key : null,
      activeTurn: session ? session.turn : -1,
      docReady: Boolean(doc)
    })
  };
}
