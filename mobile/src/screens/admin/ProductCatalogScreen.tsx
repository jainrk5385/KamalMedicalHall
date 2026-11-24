import { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadPrescription } from '../../api/upload';
import type { PrescriptionFile } from '../../store/cart';
import { endpoints } from '../../api/endpoints';
import type { Product } from '../../api/types';
import { useLoad, useErrorPopup } from '../../hooks';
import { Button, ButtonRow, Card, Message, Screen, TextField } from '../../components/ui';
import { tick } from '../../components/motion';
import { showDialog } from '../../dialog';
import { colors, spacing, type } from '../../theme';

const blank = { name:'', description:'', images:'', price:'', discountedPrice:'', stockQuantity:'0', isAvailable:true };
const parseImageIds = (value:string) => value.split(/[\\n,]/).map(id=>id.trim()).filter(id=>id.length>0 && id.startsWith('products/'));
export function ProductCatalogScreen() {
  const {data,reload,loading,error}=useLoad(()=>endpoints.admin.products());
  const [form,setForm]=useState(blank);
  const [editing,setEditing]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [previews,setPreviews]=useState<string[]>([]);
  const [showForm,setShowForm]=useState(false);
  const [err,setErr]=useState(''); useErrorPopup(err);
  const imageIds=form.images.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
  const save=async()=>{
    const price=Number(form.price), stockQuantity=Number(form.stockQuantity), discountedPrice=form.discountedPrice.trim()?Number(form.discountedPrice):null;
    if(imageIds.length===0){setErr('At least one product image is required. Please add a product photo.');return;}\n    if(!form.name.trim()||!Number.isFinite(price)||price<0||!Number.isInteger(stockQuantity)||stockQuantity<0||(discountedPrice!==null&&(!Number.isFinite(discountedPrice)||discountedPrice<0||discountedPrice>price))){setErr('Please check product name, price, discount and stock quantity.');return;}
    const isEditing=Boolean(editing);
    const payload={name:form.name.trim(),description:form.description.trim(),images:form.images.split(/\n|,/).map(x=>x.trim()).filter(Boolean),price,discountedPrice,stockQuantity,isAvailable:form.isAvailable};
    setBusy(true);setErr('');
    try{
      if(editing)await endpoints.admin.updateProduct(editing,payload);
      else await endpoints.admin.createProduct(payload);
      setForm(blank);setPreviews([]);setEditing(null);setShowForm(false);
      tick('success');
      await reload();
      await showDialog({title:isEditing?'Product Updated Successfully':'Product Added Successfully',message:isEditing?'The product details have been updated.':'The product has been added successfully.',icon:'checkmark-circle',confirmLabel:'OK'});
    }catch(e){setErr((e as Error).message);}finally{setBusy(false);}
  };
  const addImages=async()=>{
    setErr('');
    try {
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:8,quality:0.85});
      if(result.canceled||!result.assets?.length)return;
      setUploading(true);
      const existing=form.images.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
      const nextPreviews=[...previews];
      for(const asset of result.assets){
        if(existing.length>=8)break;
        const file:PrescriptionFile={id:`${Date.now()}-${existing.length}`,uri:asset.uri,name:asset.fileName??'product.jpg',mimeType:asset.mimeType?.startsWith('image/')?asset.mimeType:'image/jpeg',sizeBytes:asset.fileSize ?? undefined};
        const sig=await endpoints.signUpload('product');
        const uploaded=await uploadPrescription(file,sig);
        existing.push(uploaded.publicId);
        nextPreviews.push(uploaded.url || file.uri);
      }
      setForm({...form,images:existing.join('\n')});
      setPreviews(nextPreviews);
      tick('success');
    } catch(e){setErr((e as Error).message);} finally {setUploading(false);}
  };
  const edit=(p:Product)=>{const ids=parseImageIds((p.imagePublicIds ?? []).join('\\n'));setEditing(p.id);setPreviews(ids.map((_,i)=>p.images?.[i] ?? ''));setForm({name:p.name,description:p.description,images:ids.join('\n'),price:String(p.price),discountedPrice:p.discountedPrice==null?'':String(p.discountedPrice),stockQuantity:String(p.stockQuantity),isAvailable:p.isAvailable});setShowForm(true);};
  const removeImage=(index:number)=>{
    const imageIds=form.images.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
    imageIds.splice(index,1);
    const nextPreviews=[...previews];
    nextPreviews.splice(index,1);
    setForm({...form,images:imageIds.join('\n')});
    setPreviews(nextPreviews);
  };
  const remove=async(p:Product)=>{const ok=await showDialog({title:'Delete product?',message:`Delete “${p.name}”? This cannot be undone.`,icon:'trash',tone:'danger',confirmLabel:'Delete',cancelLabel:'Cancel'});if(!ok)return;try{await endpoints.admin.deleteProduct(p.id);await reload();tick('success');}catch(e){setErr((e as Error).message);}};
  return <Screen>
    <Text style={[type.h2,{color:colors.text}]}>Product catalogue</Text>
    <Text style={[type.small,{color:colors.secondary}]}>Manage customer-facing products. Upload up to 8 product photos. Products are informational only; no cart or checkout.</Text>
    <Button title={showForm?'Close product form':'Add product'} onPress={()=>{
      if(showForm){setShowForm(false);setEditing(null);setForm(blank);setPreviews([]);}
      else{setEditing(null);setForm(blank);setPreviews([]);setShowForm(true);}
    }}/>
    <Text style={[type.h3,{color:colors.text,marginTop:spacing.md,marginBottom:spacing.xs}]}>Products ({data?.products.length??0})</Text>
    {loading&&!data?<Text>Loading…</Text>:error&&!data?<Text>{error}</Text>:!data?.products.length?<Message icon="cube-outline" title="No products added yet"/>:data.products.map(p=><Card key={p.id} style={{gap:10,marginBottom:spacing.md}}>
      <View style={{flexDirection:'row',gap:12,alignItems:'center'}}>{p.images[0]?<Image source={{uri:p.images[0]}} style={{width:64,height:64,borderRadius:10}} resizeMode="contain"/>:null}<View style={{flex:1,gap:4}}><Text style={[type.bodyMedium,{color:colors.text}]}>{p.name}</Text><Text style={[type.small,{color:colors.secondary}]}>₹{p.discountedPrice??p.price} · Stock {p.stockQuantity} · {p.isAvailable?'Available':'Unavailable'}</Text></View></View>
      <ButtonRow><Button small variant="outline" title="Edit" onPress={()=>edit(p)}/><Button small variant="danger" title="Delete" onPress={()=>{void remove(p);}}/></ButtonRow>
    </Card>)}
    {showForm?<Card style={{gap:10,marginTop:spacing.lg}}>
      <Text style={[type.h3,{color:colors.text}]}>{editing?'Edit product':'Add product'}</Text>
      <TextField label="Product name *" value={form.name} onChangeText={v=>setForm({...form,name:v})}/>
      <TextField label="Description" value={form.description} onChangeText={v=>setForm({...form,description:v})} multiline/>
      <Text style={[type.small,{color:colors.secondary}]}>Product photos ({imageIds.length}/8)</Text>
      <Button title={uploading?"Uploading images…":imageIds.length?"Add more photos":"Add product photos"} icon="images" variant="outline" loading={uploading} onPress={()=>{void addImages();}} disabled={uploading||imageIds.length>=8}/>
      {imageIds.length>0?<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:10,paddingVertical:4}}>{imageIds.map((id,index)=><View key={`${id}-${index}`} style={{width:104,gap:4}}>{previews[index]?<Image source={{uri:previews[index]}} style={{width:104,height:104,borderRadius:10,backgroundColor:colors.card}} resizeMode="contain"/>:<View style={{width:104,height:104,borderRadius:10,backgroundColor:colors.card,alignItems:'center',justifyContent:'center'}}><Text style={[type.small,{color:colors.secondary}]}>Image attached</Text></View>}<Button small title="Remove" variant="ghost" onPress={()=>removeImage(index)}/></View>)}</ScrollView>:<Text style={[type.small,{color:colors.secondary}]}>No product photos added yet. You can add photos using the button above.</Text>}
      <TextField label="Price (₹) *" value={form.price} onChangeText={v=>setForm({...form,price:v})} keyboardType="decimal-pad"/>
      <TextField label="Discounted price (₹)" value={form.discountedPrice} onChangeText={v=>setForm({...form,discountedPrice:v})} keyboardType="decimal-pad"/>
      <TextField label="Stock quantity *" value={form.stockQuantity} onChangeText={v=>setForm({...form,stockQuantity:v})} keyboardType="number-pad"/>
      <ButtonRow><Button title={form.isAvailable?'Available':'Unavailable'} variant="outline" onPress={()=>setForm({...form,isAvailable:!form.isAvailable})}/><Button title={busy?'Saving…':editing?'Update product':'Save product'} loading={busy} onPress={()=>{void save();}}/></ButtonRow>
      <Button title="Cancel" variant="ghost" onPress={()=>{setShowForm(false);setEditing(null);setForm(blank);setPreviews([]);}}/>
    </Card>:null}
  </Screen>;
}
