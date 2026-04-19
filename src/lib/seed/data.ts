/**
 * Seed data for player name generation and team name generation.
 * Original: MySQL `Names` table (43 rows) and `teamNames` table (27 rows).
 * These are representative baseball-style names; the original DB data was
 * stored in binary .MYD files and not directly readable.
 */

export const FIRST_NAMES = [
  'James', 'John', 'Robert', 'Michael', 'David',
  'William', 'Richard', 'Joseph', 'Thomas', 'Charles',
  'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald',
  'Steven', 'Andrew', 'Paul', 'Joshua', 'Kenneth',
  'Kevin', 'Brian', 'George', 'Timothy', 'Ronald',
  'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob',
  'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen',
  'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin',
  'Samuel', 'Raymond', 'Patrick',
  'Alexander', 'Tyler', 'Dylan', 'Aaron', 'Nathan',
  'Zachary', 'Adam', 'Henry', 'Douglas', 'Peter',
  'Jack', 'Dennis', 'Jerry', 'Travis', 'Austin',
  'Sean', 'Jesse', 'Bryan', 'Vincent', 'Russell',
  'Philip', 'Elijah', 'Caleb', 'Logan', 'Mason',
  'Ethan', 'Owen', 'Luke', 'Hunter', 'Liam',
  'Noah', 'Carter', 'Jayden', 'Connor', 'Landon',
  'Christian', 'Cole', 'Gabriel', 'Isaiah', 'Cameron',
  'Chase', 'Jordan', 'Colton', 'Tristan', 'Marcus',
  'Derek', 'Dominic', 'Ian', 'Blake', 'Grant',
  'Xavier', 'Jared', 'Miles', 'Wesley', 'Dakota',
  'Shane', 'Tanner',
] as const; // 100 names

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones',
  'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson',
  'Martin', 'Lee', 'Thompson', 'White', 'Harris',
  'Clark', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres',
  'Hill', 'Green', 'Adams', 'Baker', 'Gonzalez',
  'Nelson', 'Carter', 'Mitchell', 'Perez', 'Roberts',
  'Turner', 'Phillips', 'Campbell',
  'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart',
  'Sanchez', 'Morris', 'Rogers', 'Reed', 'Cook',
  'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera',
  'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward',
  'Peterson', 'Gray', 'Ramirez', 'James', 'Watson',
  'Brooks', 'Kelly', 'Sanders', 'Price', 'Bennett',
  'Wood', 'Barnes', 'Ross', 'Henderson', 'Coleman',
  'Jenkins', 'Perry', 'Powell', 'Long', 'Patterson',
  'Hughes', 'Flores', 'Washington', 'Butler', 'Simmons',
  'Foster', 'Gonzales', 'Bryant', 'Alexander', 'Russell',
  'Griffin', 'Diaz', 'Hayes', 'Myers', 'Ford',
  'Hamilton', 'Sullivan',
] as const; // 100 names

export const TEAM_CITIES = [
  'Houston', 'Chicago', 'Phoenix', 'Dallas', 'Denver',
  'Austin', 'Memphis', 'Seattle', 'Portland', 'Atlanta',
  'Raleigh', 'Omaha', 'Toledo', 'Tampa', 'Tucson',
  'Newark', 'Buffalo', 'Fresno', 'Norfolk', 'Richmond',
  'Spokane', 'Savannah', 'Durham', 'Salem', 'Mobile',
  'Reno', 'Eugene',
] as const; // 27 cities

export const TEAM_NICKNAMES = [
  'Sharks', 'Thunderbolts', 'Wildcats', 'Gladiators', 'Raptors',
  'Pioneers', 'Stallions', 'Vipers', 'Titans', 'Phantoms',
  'Firebirds', 'Wolves', 'Rebels', 'Knights', 'Storm',
  'Mavericks', 'Hawks', 'Generals', 'Scorpions', 'Bulldogs',
  'Rangers', 'Legends', 'Cobras', 'Rockets', 'Grizzlies',
  'Comets', 'Mustangs',
] as const; // 27 nicknames

/** Positions for the 20 hitters per team */
export const HITTER_POSITIONS = [
  'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
  'UTIL', 'UTIL', 'UTIL', 'UTIL', 'UTIL', // 5 non-roster
] as const;

/**
 * Batting order for each of the 20 hitter slots.
 * 1-9 = starting lineup, 10-15 = bench, 0 = non-roster.
 */
export const HITTER_BATT_ORDER = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 13, 14, 15,
  0, 0, 0, 0, 0,
] as const;

/**
 * Rotation slots for the 20 pitchers per team.
 * 1-5 = starting rotation, 6-9 = bullpen, 0 = non-roster.
 */
export const PITCHER_ROTATION_SLOTS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
] as const;
