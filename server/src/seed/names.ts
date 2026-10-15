/**
 * Deterministic randomness and culturally appropriate name pools for the demo data generator.
 * Never use Math.random in seeding: every server instance must generate identical data.
 */

/** mulberry32 PRNG seeded from a string (FNV-1a hash). */
export function makeRng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let a = h || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)];
  const chance = (p: number) => next() < p;
  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  };
  const digits = (n: number) => Array.from({ length: n }, () => String(int(0, 9))).join('');
  const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + int(0, 25))).join('');
  /** Weighted choice: [[value, weight], ...]. */
  const weighted = <T>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [v, w] of items) { if ((r -= w) < 0) return v; }
    return items[items.length - 1][0];
  };
  return { next, int, pick, chance, shuffle, digits, letters, weighted };
}
export type Rng = ReturnType<typeof makeRng>;

export interface NamePool { male: string[]; female: string[]; last: string[] }

/* ---------------- India ---------------- */
const IN_MALE = ['Aarav', 'Rohan', 'Vikram', 'Arjun', 'Rahul', 'Karthik', 'Siddharth', 'Aditya', 'Nikhil', 'Pranav', 'Varun', 'Abhishek', 'Manoj', 'Sanjay', 'Deepak', 'Harish', 'Ravi', 'Suresh', 'Imran', 'Faisal', 'Gaurav', 'Akash', 'Kunal', 'Vivek', 'Naveen', 'Srinivas', 'Ajay', 'Tushar', 'Omkar', 'Yash'];
const IN_FEMALE = ['Priya', 'Ananya', 'Meera', 'Divya', 'Sneha', 'Kavya', 'Pooja', 'Neha', 'Shruti', 'Lakshmi', 'Aishwarya', 'Swati', 'Nandini', 'Ritika', 'Sana', 'Farah', 'Anjali', 'Deepa', 'Revathi', 'Gayatri', 'Isha', 'Tanvi', 'Shreya', 'Madhuri', 'Bhavana', 'Keerthi', 'Asha', 'Rekha', 'Aparna', 'Nisha'];
const IN_LAST_NATIONAL = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Iyer', 'Banerjee', 'Das', 'Khan', 'Mishra', 'Agarwal', 'Chatterjee', 'Fernandes', 'Kapoor', 'Saxena', 'Jain', 'Bose', 'Pandey', 'Sinha'];
const IN_LAST_REGION: Record<string, string[]> = {
  Maharashtra: ['Patil', 'Deshmukh', 'Kulkarni', 'Joshi', 'Pawar', 'Jadhav', 'Shinde', 'Gokhale', 'Bhosale', 'Shaikh', 'Shah', 'Mehta', 'Desai', 'Naik'],
  Kerala: ['Nair', 'Menon', 'Pillai', 'Kurian', 'Thomas', 'Varghese', 'Panicker', 'Warrier', 'Namboothiri', 'Mathew', 'Joseph', 'Kutty', 'Rahman', 'Jacob'],
  Telangana: ['Reddy', 'Rao', 'Naidu', 'Goud', 'Chowdary', 'Varma', 'Yadav', 'Prasad', 'Murthy', 'Kumar', 'Hussain', 'Shetty', 'Raju', 'Sastry'],
};
export function indianPool(region?: string): NamePool {
  return { male: IN_MALE, female: IN_FEMALE, last: [...(IN_LAST_REGION[region || ''] || []), ...(IN_LAST_REGION[region || ''] || []), ...IN_LAST_NATIONAL] };
}

/* ---------------- GCC nationals and expatriates ---------------- */
export const POOLS: Record<string, NamePool> = {
  Emirati: { male: ['Mohammed', 'Ahmed', 'Khalid', 'Saeed', 'Rashid', 'Hamdan', 'Sultan', 'Omar', 'Majid', 'Obaid'], female: ['Fatima', 'Mariam', 'Aisha', 'Shamma', 'Hessa', 'Noura', 'Maitha', 'Latifa', 'Amna', 'Moza'], last: ['Al Mansoori', 'Al Hashimi', 'Al Mazrouei', 'Al Nuaimi', 'Al Shamsi', 'Al Ketbi', 'Al Falasi', 'Al Suwaidi', 'Al Dhaheri', 'Al Marzooqi'] },
  Saudi: { male: ['Abdullah', 'Faisal', 'Turki', 'Fahad', 'Saud', 'Nawaf', 'Majed', 'Bandar', 'Abdulrahman', 'Yousef', 'Mishal', 'Sultan'], female: ['Nora', 'Reem', 'Lama', 'Sara', 'Haifa', 'Abeer', 'Dalia', 'Jawaher', 'Hind', 'Ghada'], last: ['Al Otaibi', 'Al Qahtani', 'Al Ghamdi', 'Al Harbi', 'Al Dosari', 'Al Shehri', 'Al Mutairi', 'Al Zahrani', 'Al Anazi', 'Al Subaie', 'Al Shammari'] },
  Qatari: { male: ['Hamad', 'Jassim', 'Nasser', 'Khalifa', 'Ali', 'Abdulaziz', 'Mohammed', 'Fahad'], female: ['Al Anoud', 'Moza', 'Sheikha', 'Hind', 'Noor', 'Dana', 'Maryam', 'Aljazi'], last: ['Al Kuwari', 'Al Marri', 'Al Sulaiti', 'Al Mohannadi', 'Al Kaabi', 'Al Naimi', 'Al Emadi', 'Al Hajri', 'Al Muhannadi', 'Al Mana'] },
  Indian: { male: IN_MALE, female: IN_FEMALE, last: ['Nair', 'Menon', 'Pillai', 'Kurian', 'Thomas', 'Sharma', 'Reddy', 'Rao', 'Shaikh', 'D\'Souza', 'Fernandes', 'Iyer', 'Varghese', 'Joseph', 'Khan', 'Patel'] },
  Pakistani: { male: ['Imran', 'Bilal', 'Usman', 'Hassan', 'Asif', 'Kamran', 'Zeeshan', 'Fahad', 'Waqas'], female: ['Ayesha', 'Sana', 'Zainab', 'Hira', 'Mahnoor', 'Saima'], last: ['Qureshi', 'Malik', 'Butt', 'Chaudhry', 'Siddiqui', 'Raza', 'Awan', 'Mirza', 'Sheikh'] },
  Filipino: { male: ['Jose', 'Mark', 'John Paul', 'Ramon', 'Carlo', 'Jerome', 'Paolo', 'Rey'], female: ['Maria', 'Kristine', 'Jasmine', 'Angelica', 'Joy', 'Rowena', 'Mae', 'Grace'], last: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Villanueva', 'Dela Cruz', 'Ramos', 'Aquino'] },
  Egyptian: { male: ['Mostafa', 'Mahmoud', 'Amr', 'Karim', 'Tarek', 'Sherif', 'Hany', 'Ahmed'], female: ['Mona', 'Yasmin', 'Heba', 'Rania', 'Nourhan', 'Salma'], last: ['Hassan', 'Abdelrahman', 'El Sayed', 'Fawzy', 'Mansour', 'Ibrahim', 'Soliman', 'Farouk', 'Gamal'] },
  Jordanian: { male: ['Zaid', 'Laith', 'Rami', 'Omar', 'Hamza', 'Yazan'], female: ['Lina', 'Dima', 'Ruba', 'Tala', 'Rana'], last: ['Al Khatib', 'Obeidat', 'Al Zoubi', 'Haddad', 'Nasser', 'Al Masri', 'Tamimi'] },
  Lebanese: { male: ['Georges', 'Elie', 'Karim', 'Rabih', 'Fadi', 'Marwan'], female: ['Nadine', 'Rita', 'Maya', 'Carla', 'Joelle', 'Lara'], last: ['Khoury', 'Saliba', 'Nassar', 'Abi Nader', 'Haddad', 'Karam', 'Chidiac'] },
  British: { male: ['James', 'Oliver', 'Thomas', 'Daniel', 'William', 'Matthew'], female: ['Emma', 'Charlotte', 'Sophie', 'Hannah', 'Lucy', 'Rebecca'], last: ['Smith', 'Taylor', 'Clarke', 'Hughes', 'Wright', 'Evans', 'Turner', 'Walker'] },
  Nepali: { male: ['Ram', 'Bikash', 'Suman', 'Prakash', 'Dipak', 'Santosh'], female: ['Sita', 'Anita', 'Sunita', 'Puja'], last: ['Gurung', 'Tamang', 'Shrestha', 'Thapa', 'Rai', 'Magar', 'Karki'] },
  Bangladeshi: { male: ['Rahim', 'Shahidul', 'Mizanur', 'Rafiq', 'Jahangir', 'Kamal'], female: ['Nasrin', 'Taslima', 'Rokeya'], last: ['Hossain', 'Rahman', 'Islam', 'Uddin', 'Miah', 'Sarkar'] },
  American: {
    male: ['Michael', 'David', 'James', 'Christopher', 'Daniel', 'Matthew', 'Andrew', 'Joshua', 'Brandon', 'Tyler', 'Kevin', 'Jose', 'Luis', 'Carlos', 'Wei', 'Jun', 'Raj', 'Marcus', 'Darnell', 'Ethan', 'Noah', 'Ryan', 'Jordan', 'Samuel', 'Benjamin'],
    female: ['Jennifer', 'Jessica', 'Ashley', 'Emily', 'Sarah', 'Amanda', 'Megan', 'Lauren', 'Rachel', 'Olivia', 'Sofia', 'Maria', 'Gabriela', 'Mei', 'Grace', 'Priya', 'Aaliyah', 'Keisha', 'Hannah', 'Chloe', 'Madison', 'Natalie', 'Rebecca', 'Victoria', 'Alexis'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Martinez', 'Rodriguez', 'Lopez', 'Hernandez', 'Nguyen', 'Kim', 'Patel', 'Chen', 'Wong', 'Davis', 'Miller', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Lee', 'Walker', 'Hall', 'Young', 'Allen', 'Washington', 'Murphy', 'Rivera', 'Cohen', 'Okafor', 'Sullivan', 'Bennett', 'Ramirez', 'Brooks', 'Price', 'Foster', 'Hughes'],
  },
};

export const NATIONALITY_LABEL: Record<string, string> = {
  Emirati: 'Emirati', Saudi: 'Saudi', Qatari: 'Qatari', Indian: 'Indian', Pakistani: 'Pakistani', Filipino: 'Filipino', Egyptian: 'Egyptian',
  Jordanian: 'Jordanian', Lebanese: 'Lebanese', British: 'British', Nepali: 'Nepali', Bangladeshi: 'Bangladeshi', American: 'American',
};

/** GCC workforce mix per country: [nationality, share]. The first entry is the national share. */
export const GCC_MIX: Record<string, [string, number][]> = {
  AE: [['Emirati', 0.1], ['Indian', 0.3], ['Pakistani', 0.14], ['Filipino', 0.15], ['Egyptian', 0.08], ['Jordanian', 0.05], ['Lebanese', 0.05], ['British', 0.05], ['Nepali', 0.08]],
  SA: [['Saudi', 0.33], ['Indian', 0.2], ['Pakistani', 0.14], ['Egyptian', 0.12], ['Filipino', 0.07], ['Bangladeshi', 0.08], ['Jordanian', 0.06]],
  QA: [['Qatari', 0.1], ['Indian', 0.2], ['Filipino', 0.24], ['Nepali', 0.12], ['Egyptian', 0.1], ['Lebanese', 0.08], ['British', 0.07], ['Pakistani', 0.09]],
};
export const NATIONAL_OF: Record<string, string> = { AE: 'Emirati', SA: 'Saudi', QA: 'Qatari' };

/** "Al Mansoori" → "almansoori", "D'Souza" → "dsouza" (for e-mail local parts). */
export const slugName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
