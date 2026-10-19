// Translation of the timetable notes ("observações") from the official Portuguese into Czech and English.
// Names of lines, stops and places always stay as printed. Anything unknown is shown in the original, and the
// real-data test lists texts that still lack a translation.
import type { Lang } from '../i18n';
import { EXTRA } from './notes-extra';

type Tr = [cs: string, en: string];

const clean = (s: string) =>
  s
    .normalize('NFC')
    .replace(/­/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s./]+$/, '');

/** Fixed phrases (compared case-insensitively, after `clean`). */
const EXACT: Record<string, Tr> = {
  'A partir / Até Achada': ['Od / do Achada', 'From / to Achada'],
  'Apenas na 6ª feira': ['Pouze v pátek', 'Fridays only'],
  'Até / Da paragem “Maxmat Cancela (1706)”': ['Do / ze zastávky “Maxmat Cancela (1706)”', 'To / from stop “Maxmat Cancela (1706)”'],
  'Até / Do Bairro São Gonçalo, paragem “QTA Rocha, T-40 (1273)”': [
    'Do / z Bairro São Gonçalo, zastávka “QTA Rocha, T-40 (1273)”',
    'To / from Bairro São Gonçalo, stop “QTA Rocha, T-40 (1273)”',
  ],
  'Até / Do CAM dos Marcos, paragem “CAM dos Marcos, T-19 (1341)”': [
    'Do / z CAM dos Marcos, zastávka “CAM dos Marcos, T-19 (1341)”',
    'To / from CAM dos Marcos, stop “CAM dos Marcos, T-19 (1341)”',
  ],
  'Até / Do Vale das Neves, paragem “Neves, T-38 (191)”': ['Do / z Vale das Neves, zastávka “Neves, T-38 (191)”', 'To / from Vale das Neves, stop “Neves, T-38 (191)”'],
  'Até CZ ESTR C Camacho Freitas, paragem “Armazém Inteligente (1068)”': [
    'Do CZ ESTR C Camacho Freitas, zastávka “Armazém Inteligente (1068)”',
    'To CZ ESTR C Camacho Freitas, stop “Armazém Inteligente (1068)”',
  ],
  'Até Chão do Carlinhos, paragem “Chão Carlinhos (594)”': ['Do Chão do Carlinhos, zastávka “Chão Carlinhos (594)”', 'To Chão do Carlinhos, stop “Chão Carlinhos (594)”'],
  'Até Lombos e Lajinhas': ['Do Lombos a Lajinhas', 'To Lombos and Lajinhas'],
  'Até Lombos e Lajinhas (não passa na paragem Largo da Fonte, T-20 (540))': [
    'Do Lombos a Lajinhas (nezastavuje na zastávce Largo da Fonte, T-20 (540))',
    'To Lombos and Lajinhas (does not call at stop Largo da Fonte, T-20 (540))',
  ],
  'Até paragem Largo do Miranda, S (359) se não tiver passageiros a bordo para o restante percurso': [
    'Do zastávky Largo do Miranda, S (359), pokud nejsou na palubě cestující na zbytek trasy',
    'To stop Largo do Miranda, S (359) if there are no passengers on board for the rest of the route',
  ],
  'Até paragem Monte, Tanque, D (534) (não passa na paragem Monte PQ Corujeira (1557))': [
    'Do zastávky Monte, Tanque, D (534) (nezastavuje na zastávce Monte PQ Corujeira (1557))',
    'To stop Monte, Tanque, D (534) (does not call at stop Monte PQ Corujeira (1557))',
  ],
  'Até paragem “CAM Lombada, Antes ROT (1369)”/ Da paragem “CAM Lombada, Depois ROT (1300)”': [
    'Do zastávky “CAM Lombada, Antes ROT (1369)” / ze zastávky “CAM Lombada, Depois ROT (1300)”',
    'To stop “CAM Lombada, Antes ROT (1369)” / from stop “CAM Lombada, Depois ROT (1300)”',
  ],
  'Até/ Das Lajinhas (não passa na paragem Monte PQ Corujeira (1557))': [
    'Do / z Lajinhas (nezastavuje na zastávce Monte PQ Corujeira (1557))',
    'To / from Lajinhas (does not call at stop Monte PQ Corujeira (1557))',
  ],
  'Até/ Dos Lombos (na ida não passa na paragem Largo da Fonte, T-20 (540))': [
    'Do / z Lombos (při jízdě tam nezastavuje na zastávce Largo da Fonte, T-20 (540))',
    'To / from Lombos (on the outbound trip does not call at stop Largo da Fonte, T-20 (540))',
  ],
  'Até/ Dos Lombos (não passa na paragem Monte PQ Corujeira (1557))': [
    'Do / z Lombos (nezastavuje na zastávce Monte PQ Corujeira (1557))',
    'To / from Lombos (does not call at stop Monte PQ Corujeira (1557))',
  ],
  'Até/Das mercearias do Palheiro Ferreiro, paragens “Lagoas Palheiro Ferreiro (1153)” e “Lagoas Palheiro Ferreiro, C37 (1110)”': [
    'Do / z obchodů v Palheiro Ferreiro, zastávky “Lagoas Palheiro Ferreiro (1153)” a “Lagoas Palheiro Ferreiro, C37 (1110)”',
    'To / from the grocery shops of Palheiro Ferreiro, stops “Lagoas Palheiro Ferreiro (1153)” and “Lagoas Palheiro Ferreiro, C37 (1110)”',
  ],
  'CARREIRA Nº 137 - com passagem por Câmara de Lobos, Fonte da Rocha, Levada Nova, Vargem e términus no Cam.Rib.Real': [
    'LINKA č. 137 – přes Câmara de Lobos, Fonte da Rocha, Levada Nova, Vargem, konečná v Cam.Rib.Real',
    'LINE No. 137 – via Câmara de Lobos, Fonte da Rocha, Levada Nova, Vargem, terminating at Cam.Rib.Real',
  ],
  'CARREIRA Nº 137 - saída do Caminho do Ribeiro Real sobe até à Vargem , Levada Nova, Câmara de Lobos e Funchal': [
    'LINKA č. 137 – odjezd z Caminho do Ribeiro Real, stoupá do Vargem, dále Levada Nova, Câmara de Lobos a Funchal',
    'LINE No. 137 – leaves Caminho do Ribeiro Real, climbs to Vargem, then Levada Nova, Câmara de Lobos and Funchal',
  ],
  'Com destino a São Roque - direto': ['Směr São Roque – přímo', 'Towards São Roque – direct'],
  'Com excepção à 3ª feira (de novembro a abril)': ['Kromě úterý (od listopadu do dubna)', 'Except Tuesdays (November to April)'],
  'Com excepção à 6ª feira (de dezembro a janeiro)': ['Kromě pátku (od prosince do ledna)', 'Except Fridays (December to January)'],
  'Com partida do Camacha Shopping, via Largo da Achada': ['S odjezdem z Camacha Shopping přes Largo da Achada', 'Departing from Camacha Shopping via Largo da Achada'],
  'Da Penteada, paragem “APS Penteada, S (655)”': ['Z Penteada, zastávka “APS Penteada, S (655)”', 'From Penteada, stop “APS Penteada, S (655)”'],
  'Da paragem “Campo da Barca (371)” a Viana': ['Ze zastávky “Campo da Barca (371)” do Viana', 'From stop “Campo da Barca (371)” to Viana'],
  'Da paragem “Campo da Barca (371)” a Viana. Só nos dias letivos': [
    'Ze zastávky “Campo da Barca (371)” do Viana. Jen ve školní dny.',
    'From stop “Campo da Barca (371)” to Viana. School days only.',
  ],
  'De / Até S.Cruz': ['Z / do S.Cruz', 'From / to S.Cruz'],
  'De Viana à paragem “Campo da Barca (371)”': ['Z Viana na zastávku “Campo da Barca (371)”', 'From Viana to stop “Campo da Barca (371)”'],
  'De Viana à paragem “Campo da Barca (371)”. Só nos dias letivos': [
    'Z Viana na zastávku “Campo da Barca (371)”. Jen ve školní dny.',
    'From Viana to stop “Campo da Barca (371)”. School days only.',
  ],
  'De/Até Boqueirão': ['Z / do Boqueirão', 'From / to Boqueirão'],
  'De/Até Camacha': ['Z / do Camacha', 'From / to Camacha'],
  'Dias úteis letivos': ['Pracovní dny (školní)', 'School weekdays'],
  'Direto - Estrada Monumental': ['Přímo – Estrada Monumental', 'Direct – Estrada Monumental'],
  'Do Rochão (Borracheiro), via Achadinha': ['Z Rochão (Borracheiro) přes Achadinha', 'From Rochão (Borracheiro) via Achadinha'],
  'Efetua de seguida o trajeto da carreira 020': ['Poté jede po trase linky 020', 'Then follows the route of line 020'],
  'Efetua de seguida o trajeto da carreira 020/ 020': ['Poté jede po trase linky 020', 'Then follows the route of line 020'],
  'Efetua de seguida o trajeto da carreira 021': ['Poté jede po trase linky 021', 'Then follows the route of line 021'],
  'Efetua o trajeto da carreira 001': ['Jede po trase linky 001', 'Follows the route of line 001'],
  'Em dias letivos via Palheiro Ferreiro. Em dias não letivos via Largo da': [
    'Ve školní dny přes Palheiro Ferreiro. Ve dny mimo školní výuku přes Largo da',
    'On school days via Palheiro Ferreiro. On non-school days via Largo da',
  ],
  'Em dias não letivos, só via': ['Ve dny mimo školní výuku jen přes', 'On non-school days only via'],
  'Entre a Vargem e as Fontes': ['Mezi Vargem a Fontes', 'Between Vargem and Fontes'],
  'Entre as Eiras e as Figueirinhas': ['Mezi Eiras a Figueirinhas', 'Between Eiras and Figueirinhas'],
  'Entre as Fontes e a Vargem': ['Mezi Fontes a Vargem', 'Between Fontes and Vargem'],
  'Entre o Portinho e a Vargem': ['Mezi Portinho a Vargem', 'Between Portinho and Vargem'],
  Expresso: ['Expres', 'Express'],
  'Expresso Directo': ['Přímý expres', 'Direct express'],
  'Férias escolares': ['Školní prázdniny', 'School holidays'],
  'Inicia junto à Entrada para a Travessa dos Três Paus, paragem “Entrada Três Paus (709)”': [
    'Začíná u vjezdu do Travessa dos Três Paus, zastávka “Entrada Três Paus (709)”',
    'Starts next to the entrance of Travessa dos Três Paus, stop “Entrada Três Paus (709)”',
  ],
  'Inicia na Corrida com passagem pela Pereira e Fôro': ['Začíná v Corrida, projíždí Pereira a Fôro', 'Starts at Corrida, passing through Pereira and Fôro'],
  'Inicia na Quinta, paragem “CAM Velho Quinta, S1A (959)”': ['Začíná v Quinta, zastávka “CAM Velho Quinta, S1A (959)”', 'Starts at Quinta, stop “CAM Velho Quinta, S1A (959)”'],
  'Inicia na Quinta, paragem “CAM Velho Quinta, S1A (959)”. Ligação com a carreira 032': [
    'Začíná v Quinta, zastávka “CAM Velho Quinta, S1A (959)”. Návaznost na linku 032',
    'Starts at Quinta, stop “CAM Velho Quinta, S1A (959)”. Connects with line 032',
  ],
  'Inicia na Rua do Conselheiro, paragem “Rua Conselheiro (17A)”': ['Začíná v Rua do Conselheiro, zastávka “Rua Conselheiro (17A)”', 'Starts at Rua do Conselheiro, stop “Rua Conselheiro (17A)”'],
  'Inicia na paragem': ['Začíná na zastávce', 'Starts at the stop'],
  'Inicia nas Lajinhas': ['Začíná v Lajinhas', 'Starts at Lajinhas'],
  'Inicia nos Alecrins, paragem “Largo Alecrins, D (812)”': ['Začíná v Alecrins, zastávka “Largo Alecrins, D (812)”', 'Starts at Alecrins, stop “Largo Alecrins, D (812)”'],
  'Ligação com a carreira 032, consulte o horário desta carreira': [
    'Návaznost na linku 032, viz jízdní řád této linky',
    'Connects with line 032, see the timetable of that line',
  ],
  'Nos dias letivos o percurso é efetuado Via Bom Sucesso': ['Ve školní dny jede trasa přes Bom Sucesso', 'On school days the route runs via Bom Sucesso'],
  'Nos dias letivos o percurso é efetuado via São Gonçalo (Rua da Infância)': [
    'Ve školní dny jede trasa přes São Gonçalo (Rua da Infância)',
    'On school days the route runs via São Gonçalo (Rua da Infância)',
  ],
  'Nota: Eventualmente este horário, poderá ser alterado ou reajustado a pedido dos utentes sem AVISO PRÉVIO': [
    'Poznámka: Tento jízdní řád může být změněn nebo upraven na žádost cestujících bez předchozího upozornění.',
    'Note: This timetable may be changed or adjusted at passengers’ request without prior notice.',
  ],
  'NÃO SE REALIZAM VIAGENS AOS FERIADOS': ['Ve svátky se nejezdí', 'No service on public holidays'],
  'Não se efectuam viagens a 25 de Dezembro': ['25. prosince se nejezdí', 'No service on 25 December'],
  'Não se realizam viagens a 25 de Dezembro': ['25. prosince se nejezdí', 'No service on 25 December'],
  'Não se realizam viagens a 25 de Dezembro Horário a realizar a partir do dia 21 de Setembro 2020': [
    '25. prosince se nejezdí. Jízdní řád platí od 21. září 2020.',
    'No service on 25 December. Timetable valid from 21 September 2020.',
  ],
  'Não se realizam viagens a 25 e 26 de Dezembro e 1 de Janeiro': ['25. a 26. prosince a 1. ledna se nejezdí', 'No service on 25 and 26 December and 1 January'],
  'Parte às 06:55 do Ribeiro Serrão (B. Gasolina), só em dias letivos': [
    'Odjíždí v 06:55 z Ribeiro Serrão (B. Gasolina), jen ve školní dny',
    'Departs at 06:55 from Ribeiro Serrão (B. Gasolina), school days only',
  ],
  'Partida Maiata': ['Odjezd z Maiata', 'Departure from Maiata'],
  'Partida às 05:55 do Camacha Shopping': ['Odjezd v 05:55 z Camacha Shopping', 'Departs at 05:55 from Camacha Shopping'],
  'Periodo Escolar': ['Školní období', 'School period'],
  'Período escolar': ['Školní období', 'School period'],
  'Periodo NO Escolar': ['Mimo školní období', 'Outside the school period'],
  'Periodo NÃO Escolar': ['Mimo školní období', 'Outside the school period'],
  'Realiza-se somente no Período Escolar, sujeito ao horário lectivo': [
    'Jede pouze ve školním období, podle školního rozvrhu',
    'Runs in the school period only, subject to the school timetable',
  ],
  'Segue até Courelas, paragem “CZ das Courelas (666)”': ['Pokračuje do Courelas, zastávka “CZ das Courelas (666)”', 'Continues to Courelas, stop “CZ das Courelas (666)”'],
  'Serviço à chamada, para Largo da Achada:': ['Provoz na zavolání do Largo da Achada:', 'On-demand service to Largo da Achada:'],
  'Só em dias letivos': ['Jen ve školní dny', 'School days only'],
  'Só nos dias letivos': ['Jen ve školní dny', 'School days only'],
  'Só nos dias letivos e via São Gonçalo (Rua da Infância)': ['Jen ve školní dny a přes São Gonçalo (Rua da Infância)', 'School days only, via São Gonçalo (Rua da Infância)'],
  'Só se realiza no Período Escolar': ['Jede pouze ve školním období', 'Runs in the school period only'],
  'Termina na paragem': ['Končí na zastávce', 'Ends at the stop'],
  'Termino Aeroporto': ['Končí na letišti (Aeroporto)', 'Ends at the airport (Aeroporto)'],
  'Transbordo de/para Terra Chã': ['Přestup z/do Terra Chã', 'Transfer from/to Terra Chã'],
  'Transbordo/Change Bus': ['Přestup', 'Change bus'],
  'VIA RÁPIDA': ['Rychlostní silnicí (Via Rápida)', 'Via the expressway (Via Rápida)'],
  'VIA RÁPIDA até Quinta Grande': ['Rychlostní silnicí až do Quinta Grande', 'Via the expressway as far as Quinta Grande'],
  'VIA RÁPIDA desde Campanário': ['Rychlostní silnicí od Campanário', 'Via the expressway from Campanário'],
  'VIA RÁPIDA desde o Estreito de Câmara de Lobos': ['Rychlostní silnicí od Estreito de Câmara de Lobos', 'Via the expressway from Estreito de Câmara de Lobos'],
  'Via Achada. Entre as paragens 893 e 644 apenas é permitido entrar e sair nas paragens indicadas': [
    'Přes Achada. Mezi zastávkami 893 a 644 je nástup a výstup povolen jen na uvedených zastávkách.',
    'Via Achada. Between stops 893 and 644 boarding and alighting is only allowed at the stops indicated.',
  ],
  'Via Corujeira de Dentro até paragem Monte, Tanque, D (534) (não passa na paragem Monte PQ Corujeira (1557))': [
    'Přes Corujeira de Dentro do zastávky Monte, Tanque, D (534) (nezastavuje na zastávce Monte PQ Corujeira (1557))',
    'Via Corujeira de Dentro to stop Monte, Tanque, D (534) (does not call at stop Monte PQ Corujeira (1557))',
  ],
  'Via Escola B 2/3 Dr. Alfredo F. Nóbrega Júnior, só em dias letivos': [
    'Přes Escola B 2/3 Dr. Alfredo F. Nóbrega Júnior, jen ve školní dny',
    'Via Escola B 2/3 Dr. Alfredo F. Nóbrega Júnior, school days only',
  ],
  'Via Largo da Achada, com passagem no Camacha Shopping às 14:15': [
    'Přes Largo da Achada, s průjezdem v Camacha Shopping ve 14:15',
    'Via Largo da Achada, passing Camacha Shopping at 14:15',
  ],
  'Via Nazaré (Av. Colégio Militar, Rua África do Sul, Rua EUA), até paragem Depois da Brisa (142)': [
    'Přes Nazaré (Av. Colégio Militar, Rua África do Sul, Rua EUA), do zastávky Depois da Brisa (142)',
    'Via Nazaré (Av. Colégio Militar, Rua África do Sul, Rua EUA), to stop Depois da Brisa (142)',
  ],
  'Via Nazaré (Avenida Colégio Militar, Rua África do Sul e Rua EUA)': [
    'Přes Nazaré (Avenida Colégio Militar, Rua África do Sul a Rua EUA)',
    'Via Nazaré (Avenida Colégio Militar, Rua África do Sul and Rua EUA)',
  ],
  'Via Túnel da Nazaré, só dias letivos - Até paragem “CAM Lombada, Antes ROT (1369)”': [
    'Přes tunel Nazaré, jen ve školní dny – do zastávky “CAM Lombada, Antes ROT (1369)”',
    'Via Túnel da Nazaré, school days only – to stop “CAM Lombada, Antes ROT (1369)”',
  ],
  'Viagem que se realiza somente no Período Escolar. viagem com saída do Marco e passagem pela Corrida, Pereira e Fôro': [
    'Jízda pouze ve školním období. Odjíždí z Marco a projíždí Corrida, Pereira a Fôro',
    'Runs in the school period only. The trip leaves from Marco and passes through Corrida, Pereira and Fôro',
  ],
  'até à Ribeira Brava na Carreira nº 139': ['do Ribeira Brava linkou č. 139', 'to Ribeira Brava on line no. 139'],
  'até à Ribeira Brava pela Carreira nº 139 e entre a Rª Brava e a Arco da Calheta pela Carreira nº 142': [
    'do Ribeira Brava linkou č. 139 a mezi Rª Brava a Arco da Calheta linkou č. 142',
    'to Ribeira Brava on line no. 139 and between Rª Brava and Arco da Calheta on line no. 142',
  ],
  'circulação com passagem pela Ponte dos Frades, Bela Vista, Estreito C. Lobos e Covão': [
    'jede přes Ponte dos Frades, Bela Vista, Estreito C. Lobos a Covão',
    'runs via Ponte dos Frades, Bela Vista, Estreito C. Lobos and Covão',
  ],
  'de / até Escola': ['z / do školy (Escola)', 'from / to school (Escola)'],
  'esta viagem não se realiza nos dias 26 de Dezembro e no dia 1 de Janeiro': ['tento spoj nejede 26. prosince a 1. ledna', 'this trip does not run on 26 December and 1 January'],
  'inicia / termina na Fajã das Galinhas': ['začíná / končí v Fajã das Galinhas', 'starts / ends at Fajã das Galinhas'],
  'inicia Viagem no Estreito de Câmara de Lobos com passagem pelo Covão': [
    'jízda začíná v Estreito de Câmara de Lobos a projíždí Covão',
    'the trip starts at Estreito de Câmara de Lobos and passes through Covão',
  ],
  'realiza-se somente no Período Escolar': ['jede pouze ve školním období', 'runs in the school period only'],
  'realiza-se somente no Período Não Escolar': ['jede pouze mimo školní období', 'runs outside the school period only'],
  'tem inicio/terminus no Lombo do Moleiro': ['začíná / končí v Lombo do Moleiro', 'starts / ends at Lombo do Moleiro'],
  'tem saída da Paragem do Cruzamento das Faias - FAJÃ DA OVELHA': [
    'odjíždí ze zastávky Cruzamento das Faias – FAJÃ DA OVELHA',
    'leaves from the stop Cruzamento das Faias – FAJÃ DA OVELHA',
  ],
  'termina nas Corticeiras': ['končí v Corticeiras', 'ends at Corticeiras'],
  'torre machico': ['věž v Machicu (torre machico)', 'Machico tower (torre machico)'],
  'viagem com passagem por Câmara de Lobos, Ponte dos Frades e Caminho do Ribeiro Real e terminus na Vargem': [
    'jízda přes Câmara de Lobos, Ponte dos Frades a Caminho do Ribeiro Real, končí ve Vargem',
    'trip via Câmara de Lobos, Ponte dos Frades and Caminho do Ribeiro Real, ends at Vargem',
  ],
};

const EXACT_LC = new Map(Object.entries({ ...EXACT, ...EXTRA }).map(([k, v]) => [clean(k).toLowerCase(), v]));

/** Templates for the many "Via X" / "Até/de X" style notes; `$1` is the untranslated rest (names). */
const RULES: [RegExp, Tr][] = [
  [/^via (.+)$/i, ['přes $1', 'via $1']],
  [/^\*?serviço a pedido:\s*(.+)$/i, ['Na objednání: $1', 'On request: $1']],
  [/^CL-(\d{1,2}:\d{2})$/, ['Câmara de Lobos $1', 'Câmara de Lobos $1']],
  [/^até paragem (.+)$/i, ['Do zastávky $1', 'To stop $1']],
  [/^até\s*\/\s*(?:dos?|das?|de)\s+(.+)$/i, ['Do / z $1', 'To / from $1']],
  [/^inicia na paragem (.+)$/i, ['Začíná na zastávce $1', 'Starts at stop $1']],
  [/^com passagem (?:pelo|pela|por) (.+)$/i, ['s průjezdem přes $1', 'passing through $1']],
  [/^at[eé] (.+)$/i, ['Do $1', 'To $1']],
];

/** "via" inside an otherwise translated fragment, e.g. "Camacha Shopping, via Largo da Achada" */
const fix = (s: string, i: 0 | 1) => s.replace(/, via /g, i === 0 ? ', přes ' : ', via ');

export function translateNote(text: string, lang: Lang): string {
  if (lang === 'pt') return text;
  const i = lang === 'cs' ? 0 : 1;
  const c = clean(text);
  if (!c) return text;
  const hit = EXACT_LC.get(c.toLowerCase());
  if (hit) return hit[i];
  for (const [re, tr] of RULES) {
    const m = c.match(re);
    if (m) return fix(tr[i].replace('$1', m[1]), i);
  }
  return text;
}

/** True when `translateNote` knows the text (used by the data test to find gaps). */
export function hasTranslation(text: string): boolean {
  const c = clean(text);
  return EXACT_LC.has(c.toLowerCase()) || RULES.some(([re]) => re.test(c));
}
