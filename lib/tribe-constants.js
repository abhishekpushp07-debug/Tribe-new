/**
 * Tribe — Stage 12: Canonical 21-Tribe System Constants
 * Named after the 21 Param Vir Chakra awardees
 */

import crypto from 'crypto'

export const TRIBES = [
  {
    tribeCode: 'SOMNATH', tribeName: 'Somnath Tribe', heroName: 'Major Somnath Sharma',
    paramVirChakraName: 'Major Somnath Sharma', animalIcon: 'lion',
    primaryColor: '#B71C1C', secondaryColor: '#FFD54F', sortOrder: 1,
    quote: 'The enemy are only 50 yards from us. We are heavily outnumbered. We are under devastating fire. I shall not withdraw an inch but will fight to the last man and the last round.',
    rank: 'Major', unit: '4th Battalion, Kumaon Regiment', war: 'Indo-Pakistani War 1947',
    dateOfAction: '3 November 1947', status: 'Posthumous',
    biography: 'Major Somnath Sharma was the first recipient of the Param Vir Chakra. Born on 31 January 1923, he led his company to Badgam airfield near Srinagar to defend it against 700 Pakistani raiders. Despite having his arm in a plaster cast from a previous injury, he refused to stay behind. When his company was surrounded and outnumbered, he personally manned a forward position, directing artillery fire. He was killed by a mortar shell but his brave stand gave enough time for reinforcements to arrive, saving Srinagar.',
  },
  {
    tribeCode: 'JADUNATH', tribeName: 'Jadunath Tribe', heroName: 'Naik Jadunath Singh',
    paramVirChakraName: 'Naik Jadunath Singh', animalIcon: 'tiger',
    primaryColor: '#E65100', secondaryColor: '#FFF176', sortOrder: 2,
    quote: 'Courage does not wait for numbers.',
    rank: 'Naik', unit: '1st Battalion, Rajput Regiment', war: 'Indo-Pakistani War 1947',
    dateOfAction: '6 February 1948', status: 'Posthumous',
    biography: 'Naik Jadunath Singh was born on 21 November 1916 in Shahjahanpur, Uttar Pradesh. During the 1947 war, his nine-man picquet at Taindhar in Naushera sector came under massive attack. Despite being heavily outnumbered, he led counter-attacks three times with his Sten gun, bayonet-charging enemy positions single-handedly. In the final assault, though severely wounded, he rushed the enemy with his bayonet, killing several before falling. His extraordinary valor saved the post.',
  },
  {
    tribeCode: 'PIRU', tribeName: 'Piru Tribe', heroName: 'Company Havildar Major Piru Singh',
    paramVirChakraName: 'Company Havildar Major Piru Singh Shekhawat', animalIcon: 'panther',
    primaryColor: '#4A148C', secondaryColor: '#CE93D8', sortOrder: 3,
    quote: 'Advance through fear. Never around it.',
    rank: 'Company Havildar Major', unit: '6th Battalion, Rajputana Rifles', war: 'Indo-Pakistani War 1948',
    dateOfAction: '17 July 1948', status: 'Posthumous',
    biography: 'CHM Piru Singh Shekhawat was born on 20 May 1918 in Beri, Rajasthan. During the battle of Tithwal in Kashmir, his company attacked an enemy-held hill feature. When all officers were killed, Piru Singh took command and charged uphill under heavy fire. Single-handedly clearing enemy bunkers with grenades and bayonet, he was shot multiple times but continued fighting until he silenced the last enemy post, dying with his hand on the enemy machine gun.',
  },
  {
    tribeCode: 'KARAM', tribeName: 'Karam Tribe', heroName: 'Lance Naik Karam Singh',
    paramVirChakraName: 'Lance Naik Karam Singh', animalIcon: 'wolf',
    primaryColor: '#1B5E20', secondaryColor: '#A5D6A7', sortOrder: 4,
    quote: 'Duty is the calm inside chaos.',
    rank: 'Lance Naik', unit: '1st Battalion, Sikh Regiment', war: 'Indo-Pakistani War 1948',
    dateOfAction: '13 October 1948', status: 'Survived',
    biography: 'Lance Naik Karam Singh was born on 15 September 1915 in Barnala, Punjab. At the Battle of Tithwal, he held a forward post at Richmar Gali despite devastating mortar and artillery shelling. Though wounded, he repelled multiple waves of enemy attacks, inspiring his men to hold their ground. He is one of the few PVC recipients who survived the action that earned them the medal. He passed away on 20 January 1993.',
  },
  {
    tribeCode: 'RANE', tribeName: 'Rane Tribe', heroName: 'Second Lieutenant Rama Raghoba Rane',
    paramVirChakraName: 'Second Lieutenant Rama Raghoba Rane', animalIcon: 'rhino',
    primaryColor: '#37474F', secondaryColor: '#90A4AE', sortOrder: 5,
    quote: 'Break the obstacle. Build the path.',
    rank: 'Second Lieutenant', unit: 'Corps of Engineers (attached to 37 Rajput)', war: 'Indo-Pakistani War 1948',
    dateOfAction: '8 April 1948', status: 'Survived',
    biography: 'Second Lieutenant Rama Raghoba Rane was born on 26 June 1918 in Chendwad, Maharashtra. As a combat engineer during the advance on Rajouri, he worked continuously for 72 hours under heavy enemy fire, clearing mines and roadblocks to enable tanks and infantry to advance. Despite being wounded, he operated a bulldozer to clear obstacles while under direct fire. His engineering courage opened the only road to Rajouri, saving the besieged town.',
  },
  {
    tribeCode: 'SALARIA', tribeName: 'Salaria Tribe', heroName: 'Captain Gurbachan Singh Salaria',
    paramVirChakraName: 'Captain Gurbachan Singh Salaria', animalIcon: 'falcon',
    primaryColor: '#0D47A1', secondaryColor: '#90CAF9', sortOrder: 6,
    quote: 'Strike with speed. Rise with honour.',
    rank: 'Captain', unit: '3rd Battalion, 1st Gorkha Rifles', war: 'UN Peacekeeping, Congo 1961',
    dateOfAction: '5 December 1961', status: 'Posthumous',
    biography: 'Captain Gurbachan Singh Salaria was born on 29 November 1935 in Gurdaspur, Punjab. Serving with the UN peacekeeping force in Congo, he led a charge against a roadblock manned by 150 Gendarmerie armed with automatic weapons. With just a small Gorkha platoon, he attacked with khukris and bayonets, killing 40 enemy soldiers and clearing the roadblock. He was hit by automatic fire but his action prevented the massacre of thousands of Baluba tribespeople. He is the only Indian PVC recipient for action outside India.',
  },
  {
    tribeCode: 'THAPA', tribeName: 'Thapa Tribe', heroName: 'Major Dhan Singh Thapa',
    paramVirChakraName: 'Major Dhan Singh Thapa', animalIcon: 'snow_leopard',
    primaryColor: '#006064', secondaryColor: '#80DEEA', sortOrder: 7,
    quote: 'Hold the heights. Hold the line.',
    rank: 'Major', unit: '1st Battalion, 8th Gorkha Rifles', war: 'Sino-Indian War 1962',
    dateOfAction: '20 October 1962', status: 'Survived (POW)',
    biography: 'Major Dhan Singh Thapa was born on 10 April 1928 in Shimla. During the Chinese invasion, he commanded a forward post at Srijap-1 near Pangong Lake, Ladakh. When massively outnumbered Chinese forces attacked, he led multiple counter-attacks. After all ammunition was exhausted, he fought hand-to-hand with a khukri. Though captured as a POW, he was repatriated after the war. He is one of the few PVC recipients taken prisoner.',
  },
  {
    tribeCode: 'JOGINDER', tribeName: 'Joginder Tribe', heroName: 'Subedar Joginder Singh',
    paramVirChakraName: 'Subedar Joginder Singh', animalIcon: 'bear',
    primaryColor: '#5D4037', secondaryColor: '#D7CCC8', sortOrder: 8,
    quote: 'Strength means staying when others fall.',
    rank: 'Subedar', unit: '1st Battalion, Sikh Regiment', war: 'Sino-Indian War 1962',
    dateOfAction: '23 October 1962', status: 'Posthumous',
    biography: 'Subedar Joginder Singh was born on 26 September 1921 in Mahla Kalan, Moga, Punjab. At Bum La in the Tawang sector of NEFA, his platoon faced three waves of Chinese attacks, each 200 strong. Despite losing most of his men, he continued fighting, repelling two waves. In the third wave, wounded and out of ammunition, he led a bayonet charge. Captured by the Chinese, he died as a POW from wounds and frostbite, refusing to surrender his spirit even in captivity.',
  },
  {
    tribeCode: 'SHAITAN', tribeName: 'Shaitan Tribe', heroName: 'Major Shaitan Singh',
    paramVirChakraName: 'Major Shaitan Singh', animalIcon: 'eagle',
    primaryColor: '#263238', secondaryColor: '#B0BEC5', sortOrder: 9,
    quote: 'Sacrifice turns duty into legend.',
    rank: 'Major', unit: '13th Battalion, Kumaon Regiment', war: 'Sino-Indian War 1962',
    dateOfAction: '18 November 1962', status: 'Posthumous',
    biography: 'Major Shaitan Singh was born on 1 December 1924 in Jodhpur, Rajasthan. At the Battle of Rezang La in Chushul, Ladakh, his Charlie Company of 120 men faced over 5,000 Chinese soldiers at 16,000 feet altitude in freezing temperatures. Fighting to the last man and last round, 114 of his 120 men were killed. Major Shaitan Singh, severely wounded, continued directing fire until he succumbed. His body was found months later, still holding his weapon. This is considered one of the greatest last stands in military history.',
  },
  {
    tribeCode: 'HAMID', tribeName: 'Hamid Tribe', heroName: 'CQMH Abdul Hamid',
    paramVirChakraName: 'Company Quartermaster Havildar Abdul Hamid', animalIcon: 'cobra',
    primaryColor: '#1A237E', secondaryColor: '#9FA8DA', sortOrder: 10,
    quote: 'Precision defeats power.',
    rank: 'Company Quartermaster Havildar', unit: '4th Battalion, The Grenadiers', war: 'Indo-Pakistani War 1965',
    dateOfAction: '10 September 1965', status: 'Posthumous',
    biography: 'Abdul Hamid was born on 1 July 1933 in Dhamupur, Ghazipur, Uttar Pradesh. During the Battle of Asal Uttar at Khem Karan, he mounted a recoilless gun on a jeep and single-handedly destroyed 7 Pakistani Patton tanks — machines considered invincible at the time. Moving from flank to flank under intense fire, he broke the back of the Pakistani armoured assault. He was killed by enemy fire while engaging the 8th tank. His action saved the entire Khem Karan sector from falling.',
  },
  {
    tribeCode: 'TARAPORE', tribeName: 'Tarapore Tribe', heroName: 'Lt Col Ardeshir Burzorji Tarapore',
    paramVirChakraName: 'Lt Col Ardeshir Burzorji Tarapore', animalIcon: 'bull',
    primaryColor: '#880E4F', secondaryColor: '#F48FB1', sortOrder: 11,
    quote: 'Lead from the front. Always.',
    rank: 'Lieutenant Colonel', unit: '17 Poona Horse (Armoured Regiment)', war: 'Indo-Pakistani War 1965',
    dateOfAction: '15 October 1965', status: 'Posthumous',
    biography: 'Lt Col Ardeshir Burzorji Tarapore was born on 18 August 1923 in Bombay. A Parsi officer commanding the 17 Poona Horse, he led his regiment in the fierce tank battle of Phillora in the Sialkot sector. Over six days of continuous tank warfare, he personally led every charge from the front, destroying multiple enemy tanks. Though his tank was hit and he was wounded, he refused evacuation and continued leading until killed in action. His regiment captured Phillora, Chawinda, and Wazirwali — the largest tank battle since World War II.',
  },
  {
    tribeCode: 'EKKA', tribeName: 'Ekka Tribe', heroName: 'Lance Naik Albert Ekka',
    paramVirChakraName: 'Lance Naik Albert Ekka', animalIcon: 'jaguar',
    primaryColor: '#2E7D32', secondaryColor: '#C5E1A5', sortOrder: 12,
    quote: 'Silent grit. Relentless spirit.',
    rank: 'Lance Naik', unit: '14th Battalion, Brigade of the Guards', war: 'Indo-Pakistani War 1971',
    dateOfAction: '3 December 1971', status: 'Posthumous',
    biography: 'Lance Naik Albert Ekka was born on 27 December 1942 in Jari, Ranchi (now Jharkhand). An Adivasi soldier, he was the first tribal recipient of the PVC. During the attack on Gangasagar in the Agartala sector, he silenced an enemy bunker with a bayonet charge, then crawled to another machine-gun position under heavy fire and killed the crew. Though severely wounded in the stomach, he continued fighting until he silenced the last enemy position, dying with his bayonet embedded in an enemy soldier.',
  },
  {
    tribeCode: 'SEKHON', tribeName: 'Sekhon Tribe', heroName: 'Flying Officer Nirmal Jit Singh Sekhon',
    paramVirChakraName: 'Flying Officer Nirmal Jit Singh Sekhon', animalIcon: 'hawk',
    primaryColor: '#1565C0', secondaryColor: '#BBDEFB', sortOrder: 13,
    quote: 'Own the sky. Fear nothing.',
    rank: 'Flying Officer', unit: 'No. 18 Squadron, Indian Air Force', war: 'Indo-Pakistani War 1971',
    dateOfAction: '14 December 1971', status: 'Posthumous',
    biography: 'Flying Officer Nirmal Jit Singh Sekhon was born on 17 July 1943 in Ludhiana, Punjab. He is the only Indian Air Force officer to receive the PVC. When six Pakistani Sabres attacked Srinagar airfield, Sekhon scrambled his Gnat fighter alone, engaging all six aircraft in a dogfight. He shot down two Sabres before being hit. His aircraft crashed near the airfield. His extraordinary solo combat against overwhelming odds saved the Srinagar air base from destruction.',
  },
  {
    tribeCode: 'HOSHIAR', tribeName: 'Hoshiar Tribe', heroName: 'Major Hoshiar Singh',
    paramVirChakraName: 'Major Hoshiar Singh', animalIcon: 'bison',
    primaryColor: '#6D4C41', secondaryColor: '#BCAAA4', sortOrder: 14,
    quote: 'True force protects before it conquers.',
    rank: 'Major', unit: '3rd Battalion, The Grenadiers', war: 'Indo-Pakistani War 1971',
    dateOfAction: '17 December 1971', status: 'Survived',
    biography: 'Major Hoshiar Singh was born on 5 May 1936 in Sisana, Haryana. During the Battle of Basantar River in the Shakargarh sector, he led his company across a heavily mined river under intense artillery and machine-gun fire. Despite being seriously wounded, he continued to command his men, repelling multiple Pakistani counter-attacks. He held the vital bridgehead for over 24 hours, enabling the division to cross. He survived and retired as an Honorary Captain.',
  },
  {
    tribeCode: 'KHETARPAL', tribeName: 'Khetarpal Tribe', heroName: 'Second Lieutenant Arun Khetarpal',
    paramVirChakraName: 'Second Lieutenant Arun Khetarpal', animalIcon: 'stallion',
    primaryColor: '#3E2723', secondaryColor: '#FFCC80', sortOrder: 15,
    quote: 'No Sir, I will NOT abandon my tank. My gun is still working and I will get these bastards.',
    rank: 'Second Lieutenant', unit: '17 Poona Horse (Armoured Regiment)', war: 'Indo-Pakistani War 1971',
    dateOfAction: '16 December 1971', status: 'Posthumous',
    biography: 'Second Lieutenant Arun Khetarpal was born on 14 October 1950 in Pune. At just 21, during the Battle of Basantar, he led his Centurion tank troop against a massive Pakistani armoured counter-attack. Despite his tank being hit and set ablaze, he refused orders to abandon it, destroying multiple enemy tanks. His famous last words on the radio were: "No Sir, I will NOT abandon my tank. My gun is still working and I will get these bastards." He destroyed the last enemy tank before succumbing to his injuries.',
  },
  {
    tribeCode: 'BANA', tribeName: 'Bana Tribe', heroName: 'Naib Subedar Bana Singh',
    paramVirChakraName: 'Naib Subedar Bana Singh', animalIcon: 'mountain_wolf',
    primaryColor: '#004D40', secondaryColor: '#80CBC4', sortOrder: 16,
    quote: 'Impossible is a peak to be climbed.',
    rank: 'Naib Subedar', unit: '8th Battalion, Jammu and Kashmir Light Infantry', war: 'Siachen Conflict 1987',
    dateOfAction: '23 June 1987', status: 'Survived',
    biography: 'Naib Subedar Bana Singh was born on 6 January 1949 in RS Pura, Jammu. During Operation Rajiv on the Siachen Glacier, he led a team to capture the Pakistani-held Quaid Post at 21,153 feet — the highest battlefield in the world. Climbing near-vertical ice walls in waist-deep snow at -60°C, he led a frontal assault on the fortified bunker. The post was renamed "Bana Post" in his honour. He is one of the highest-altitude combat PVC recipients.',
  },
  {
    tribeCode: 'PARAMESWARAN', tribeName: 'Parameswaran Tribe', heroName: 'Major Ramaswamy Parameswaran',
    paramVirChakraName: 'Major Ramaswamy Parameswaran', animalIcon: 'black_panther',
    primaryColor: '#311B92', secondaryColor: '#B39DDB', sortOrder: 17,
    quote: 'Resolve is the sharpest weapon.',
    rank: 'Major', unit: '8th Battalion, Mahar Regiment', war: 'Sri Lanka Operations (IPKF) 1987',
    dateOfAction: '25 November 1987', status: 'Posthumous',
    biography: 'Major Ramaswamy Parameswaran was born on 13 September 1946 in Bombay. While serving with the Indian Peace Keeping Force in Sri Lanka, his patrol was ambushed by LTTE militants. Despite being shot in the chest, he snatched a rifle from a fallen militant and killed three attackers. He continued directing his men to safety while mortally wounded. He is the only PVC recipient for action in Sri Lanka.',
  },
  {
    tribeCode: 'PANDEY', tribeName: 'Pandey Tribe', heroName: 'Lieutenant Manoj Kumar Pandey',
    paramVirChakraName: 'Lieutenant Manoj Kumar Pandey', animalIcon: 'leopard',
    primaryColor: '#C62828', secondaryColor: '#FFAB91', sortOrder: 18,
    quote: 'If death strikes before I prove my blood, I swear I will kill death.',
    rank: 'Lieutenant', unit: '1st Battalion, 11th Gorkha Rifles', war: 'Kargil War 1999',
    dateOfAction: '3 July 1999', status: 'Posthumous',
    biography: 'Lieutenant Manoj Kumar Pandey was born on 25 June 1975 in Sitapur, Uttar Pradesh. During Operation Vijay in Kargil, he led his platoon to capture Khalubar in the Batalik sector. Climbing sheer cliffs under fire, he cleared four enemy bunkers single-handedly with grenades and close combat. While clearing the last bunker, he was fatally shot but had already turned the tide. His diary entry before the war read: "If death strikes before I prove my blood, I swear I will kill death."',
  },
  {
    tribeCode: 'YADAV', tribeName: 'Yadav Tribe', heroName: 'Grenadier Yogendra Singh Yadav',
    paramVirChakraName: 'Grenadier Yogendra Singh Yadav', animalIcon: 'iron_tiger',
    primaryColor: '#AD1457', secondaryColor: '#F8BBD0', sortOrder: 19,
    quote: 'Endurance is courage over time.',
    rank: 'Grenadier', unit: '18th Battalion, The Grenadiers (Ghatak Platoon)', war: 'Kargil War 1999',
    dateOfAction: '4 July 1999', status: 'Survived',
    biography: 'Grenadier Yogendra Singh Yadav was born on 10 May 1980 in Aurangabad Ahir, Bulandshahr, UP. At just 19, he was part of the Ghatak (commando) platoon tasked with capturing Tiger Hill. While climbing a vertical cliff face, he was shot by enemy fire — bullets hit his arm, legs, and groin. Despite 15 bullet wounds, he pulled himself up, crawled to an enemy bunker, and killed four soldiers. He then charged a second bunker with a grenade, enabling his platoon to capture Tiger Hill. He is the youngest PVC recipient.',
  },
  {
    tribeCode: 'SANJAY', tribeName: 'Sanjay Tribe', heroName: 'Rifleman Sanjay Kumar',
    paramVirChakraName: 'Rifleman Sanjay Kumar', animalIcon: 'honey_badger',
    primaryColor: '#2C3E50', secondaryColor: '#AED6F1', sortOrder: 20,
    quote: 'Keep going. Then go further.',
    rank: 'Rifleman', unit: '13th Battalion, Jammu and Kashmir Rifles', war: 'Kargil War 1999',
    dateOfAction: '5 July 1999', status: 'Survived',
    biography: 'Rifleman Sanjay Kumar was born on 3 March 1976 in Bilaspur, Himachal Pradesh. During the assault on Flat Top on Area Mushkoh in Kargil, his unit was pinned down by heavy automatic fire from enemy bunkers. He charged the nearest bunker alone, killing three enemy soldiers in hand-to-hand combat and capturing an enemy machine gun. He then turned the captured gun on the remaining positions, enabling his company to advance. Despite being shot in the forearm and leg, he continued fighting.',
  },
  {
    tribeCode: 'BATRA', tribeName: 'Batra Tribe', heroName: 'Captain Vikram Batra',
    paramVirChakraName: 'Captain Vikram Batra', animalIcon: 'phoenix_wolf',
    primaryColor: '#D32F2F', secondaryColor: '#FFCDD2', sortOrder: 21,
    quote: 'Yeh Dil Maange More! (The heart wants more!)',
    rank: 'Captain', unit: '13th Battalion, Jammu and Kashmir Rifles', war: 'Kargil War 1999',
    dateOfAction: '7 July 1999', status: 'Posthumous',
    biography: 'Captain Vikram Batra was born on 9 September 1974 in Palampur, Himachal Pradesh. Known by his codename "Sher Shah" (Lion King), he first captured Point 5140 in a daring night assault, after which he famously radioed "Yeh Dil Maange More!" He then volunteered to capture Point 4875. While evacuating a wounded officer during the assault, he was hit by enemy fire but continued to engage the enemy, killing five soldiers before succumbing to his injuries. His twin brother Vishal serves in his memory.',
  },
]

/**
 * assignTribeV3 — Deterministic, balanced, idempotent, race-safe assignment
 *
 * Uses SHA-256 hash of userId to deterministically pick one of 21 tribes.
 * Same userId always gets the same tribe. No DB read required.
 * For balanced distribution, hash modulo 21 is used.
 */
export function assignTribeV3(userId) {
  const hash = crypto.createHash('sha256').update(userId).digest('hex')
  const index = parseInt(hash.slice(0, 8), 16) % TRIBES.length
  return TRIBES[index]
}

/**
 * Map old house slug to nearest tribe (for migration)
 * Best-effort mapping based on domain similarity
 */
export const HOUSE_TO_TRIBE_MAP = {
  aryabhatta: 'HAMID',       // precision
  chanakya: 'SALARIA',       // strategy
  shivaji: 'SOMNATH',        // valor
  saraswati: 'SEKHON',       // knowledge
  dhoni: 'JOGINDER',         // composure
  kalpana: 'BATRA',          // fearless exploration
  raman: 'RANE',             // engineering
  lakshmibai: 'PANDEY',      // justice
  tagore: 'PARAMESWARAN',    // resolve
  kalam: 'KHETARPAL',        // vision
  shakuntala: 'EKKA',        // silent grit
  vikram: 'THAPA',           // endurance
}
