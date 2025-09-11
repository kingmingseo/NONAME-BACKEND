import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';
import { MarkerColor } from '../marker-color.enum';

export class CreatePostDto {
  @IsNotEmpty()
  latitude: number;

  @IsNotEmpty()
  longitude: number;

  @IsString()
  title: string;

  @IsNotEmpty()
  color: MarkerColor;

  @IsString()
  address: string;

  @IsDateString()
  date: Date;

  @IsString()
  description: string;

  @IsNumber()
  score: number;

  @IsArray()
  imageUris: { uri: string }[];
}
