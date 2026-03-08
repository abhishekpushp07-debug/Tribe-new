/**
 * Tribe — Stage 12: Canonical 21-Tribe System Constants
 * Named after the 21 Param Vir Chakra awardees
 */

import crypto from 'crypto'

export const TRIBES = [
  {
    tribeCode: 'SOMNATH',
    tribeName: 'Somnath Tribe',
    heroName: 'Major Somnath Sharma',
    paramVirChakraName: 'Major Somnath Sharma',
    animalIcon: 'lion',
    primaryColor: '#B71C1C',
    secondaryColor: '#FFD54F',
    quote: 'Stand first. Stand firm. Stand for all.',
    sortOrder: 1,
  },
  {
    tribeCode: 'JADUNATH',
    tribeName: 'Jadunath Tribe',
    heroName: 'Naik Jadunath Singh',
    paramVirChakraName: 'Naik Jadunath Singh',
    animalIcon: 'tiger',
    primaryColor: '#E65100',
    secondaryColor: '#FFF176',
    quote: 'Courage does not wait for numbers.',
    sortOrder: 2,
  },
  {
    tribeCode: 'PIRU',
    tribeName: 'Piru Tribe',
    heroName: 'Company Havildar Major Piru Singh',
    paramVirChakraName: 'Company Havildar Major Piru Singh',
    animalIcon: 'panther',
    primaryColor: '#4A148C',
    secondaryColor: '#CE93D8',
    quote: 'Advance through fear. Never around it.',
    sortOrder: 3,
  },
  {
    tribeCode: 'KARAM',
    tribeName: 'Karam Tribe',
    heroName: 'Lance Naik Karam Singh',
    paramVirChakraName: 'Lance Naik Karam Singh',
    animalIcon: 'wolf',
    primaryColor: '#1B5E20',
    secondaryColor: '#A5D6A7',
    quote: 'Duty is the calm inside chaos.',
    sortOrder: 4,
  },
  {
    tribeCode: 'RANE',
    tribeName: 'Rane Tribe',
    heroName: 'Second Lieutenant Rama Raghoba Rane',
    paramVirChakraName: 'Second Lieutenant Rama Raghoba Rane',
    animalIcon: 'rhino',
    primaryColor: '#37474F',
    secondaryColor: '#90A4AE',
    quote: 'Break the obstacle. Build the path.',
    sortOrder: 5,
  },
  {
    tribeCode: 'SALARIA',
    tribeName: 'Salaria Tribe',
    heroName: 'Captain Gurbachan Singh Salaria',
    paramVirChakraName: 'Captain Gurbachan Singh Salaria',
    animalIcon: 'falcon',
    primaryColor: '#0D47A1',
    secondaryColor: '#90CAF9',
    quote: 'Strike with speed. Rise with honour.',
    sortOrder: 6,
  },
  {
    tribeCode: 'THAPA',
    tribeName: 'Thapa Tribe',
    heroName: 'Major Dhan Singh Thapa',
    paramVirChakraName: 'Major Dhan Singh Thapa',
    animalIcon: 'snow_leopard',
    primaryColor: '#006064',
    secondaryColor: '#80DEEA',
    quote: 'Hold the heights. Hold the line.',
    sortOrder: 7,
  },
  {
    tribeCode: 'JOGINDER',
    tribeName: 'Joginder Tribe',
    heroName: 'Subedar Joginder Singh',
    paramVirChakraName: 'Subedar Joginder Singh',
    animalIcon: 'bear',
    primaryColor: '#5D4037',
    secondaryColor: '#D7CCC8',
    quote: 'Strength means staying when others fall.',
    sortOrder: 8,
  },
  {
    tribeCode: 'SHAITAN',
    tribeName: 'Shaitan Tribe',
    heroName: 'Major Shaitan Singh',
    paramVirChakraName: 'Major Shaitan Singh',
    animalIcon: 'eagle',
    primaryColor: '#263238',
    secondaryColor: '#B0BEC5',
    quote: 'Sacrifice turns duty into legend.',
    sortOrder: 9,
  },
  {
    tribeCode: 'HAMID',
    tribeName: 'Hamid Tribe',
    heroName: 'CQMH Abdul Hamid',
    paramVirChakraName: 'CQMH Abdul Hamid',
    animalIcon: 'cobra',
    primaryColor: '#1A237E',
    secondaryColor: '#9FA8DA',
    quote: 'Precision defeats power.',
    sortOrder: 10,
  },
  {
    tribeCode: 'TARAPORE',
    tribeName: 'Tarapore Tribe',
    heroName: 'Lt Col Ardeshir Burzorji Tarapore',
    paramVirChakraName: 'Lt Col Ardeshir Burzorji Tarapore',
    animalIcon: 'bull',
    primaryColor: '#880E4F',
    secondaryColor: '#F48FB1',
    quote: 'Lead from the front. Always.',
    sortOrder: 11,
  },
  {
    tribeCode: 'EKKA',
    tribeName: 'Ekka Tribe',
    heroName: 'Lance Naik Albert Ekka',
    paramVirChakraName: 'Lance Naik Albert Ekka',
    animalIcon: 'jaguar',
    primaryColor: '#2E7D32',
    secondaryColor: '#C5E1A5',
    quote: 'Silent grit. Relentless spirit.',
    sortOrder: 12,
  },
  {
    tribeCode: 'SEKHON',
    tribeName: 'Sekhon Tribe',
    heroName: 'Flying Officer Nirmal Jit Singh Sekhon',
    paramVirChakraName: 'Flying Officer Nirmal Jit Singh Sekhon',
    animalIcon: 'hawk',
    primaryColor: '#1565C0',
    secondaryColor: '#BBDEFB',
    quote: 'Own the sky. Fear nothing.',
    sortOrder: 13,
  },
  {
    tribeCode: 'HOSHIAR',
    tribeName: 'Hoshiar Tribe',
    heroName: 'Major Hoshiar Singh',
    paramVirChakraName: 'Major Hoshiar Singh',
    animalIcon: 'bison',
    primaryColor: '#6D4C41',
    secondaryColor: '#BCAAA4',
    quote: 'True force protects before it conquers.',
    sortOrder: 14,
  },
  {
    tribeCode: 'KHETARPAL',
    tribeName: 'Khetarpal Tribe',
    heroName: 'Second Lieutenant Arun Khetarpal',
    paramVirChakraName: 'Second Lieutenant Arun Khetarpal',
    animalIcon: 'stallion',
    primaryColor: '#3E2723',
    secondaryColor: '#FFCC80',
    quote: 'Charge beyond doubt.',
    sortOrder: 15,
  },
  {
    tribeCode: 'BANA',
    tribeName: 'Bana Tribe',
    heroName: 'Naib Subedar Bana Singh',
    paramVirChakraName: 'Naib Subedar Bana Singh',
    animalIcon: 'mountain_wolf',
    primaryColor: '#004D40',
    secondaryColor: '#80CBC4',
    quote: 'Impossible is a peak to be climbed.',
    sortOrder: 16,
  },
  {
    tribeCode: 'PARAMESWARAN',
    tribeName: 'Parameswaran Tribe',
    heroName: 'Major Ramaswamy Parameswaran',
    paramVirChakraName: 'Major Ramaswamy Parameswaran',
    animalIcon: 'black_panther',
    primaryColor: '#311B92',
    secondaryColor: '#B39DDB',
    quote: 'Resolve is the sharpest weapon.',
    sortOrder: 17,
  },
  {
    tribeCode: 'PANDEY',
    tribeName: 'Pandey Tribe',
    heroName: 'Lieutenant Manoj Kumar Pandey',
    paramVirChakraName: 'Lieutenant Manoj Kumar Pandey',
    animalIcon: 'leopard',
    primaryColor: '#C62828',
    secondaryColor: '#FFAB91',
    quote: 'If the mission is worthy, give all.',
    sortOrder: 18,
  },
  {
    tribeCode: 'YADAV',
    tribeName: 'Yadav Tribe',
    heroName: 'Grenadier Yogendra Singh Yadav',
    paramVirChakraName: 'Grenadier Yogendra Singh Yadav',
    animalIcon: 'iron_tiger',
    primaryColor: '#AD1457',
    secondaryColor: '#F8BBD0',
    quote: 'Endurance is courage over time.',
    sortOrder: 19,
  },
  {
    tribeCode: 'SANJAY',
    tribeName: 'Sanjay Tribe',
    heroName: 'Rifleman Sanjay Kumar',
    paramVirChakraName: 'Rifleman Sanjay Kumar',
    animalIcon: 'honey_badger',
    primaryColor: '#2C3E50',
    secondaryColor: '#AED6F1',
    quote: 'Keep going. Then go further.',
    sortOrder: 20,
  },
  {
    tribeCode: 'BATRA',
    tribeName: 'Batra Tribe',
    heroName: 'Captain Vikram Batra',
    paramVirChakraName: 'Captain Vikram Batra',
    animalIcon: 'phoenix_wolf',
    primaryColor: '#D32F2F',
    secondaryColor: '#FFCDD2',
    quote: 'Victory belongs to the fearless.',
    sortOrder: 21,
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
